// Rate limit (send_rate_state) & retention: docs/requirements/security-list.md §1 + §6
// Message charset: docs/requirements/message-content.md
// Query patterns: docs/requirements/server-query-patterns.md
use spacetimedb::{
    reducer, table, Identity, ReducerContext, ScheduleAt, Table, TimeDuration, Timestamp,
};

const MAX_MESSAGES_PER_WINDOW: u32 = 2;
const MAX_USERNAME_LEN: usize = 13;
const MAX_MESSAGE_TEXT_LEN: usize = 400;

fn rate_window() -> TimeDuration {
    TimeDuration::from_micros(60 * 1_000_000)
}

fn message_retention() -> TimeDuration {
    TimeDuration::from_micros(72 * 3600 * 1_000_000)
}

fn cleanup_interval() -> TimeDuration {
    TimeDuration::from_micros(15 * 60 * 1_000_000)
}

// 1. Tabelle für aktive Online-User pro URL (Presence)
#[table(name = user_session, public)]
pub struct UserSession {
    #[primary_key]
    pub identity: Identity,
    pub current_url: String,
    pub username: String,
    pub joined_at: Timestamp,
}

// 2. Tabelle für Chat-Nachrichten
#[table(name = chat_message, public)]
pub struct ChatMessage {
    #[auto_inc]
    #[primary_key]
    pub id: u64,
    pub url: String,
    pub sender_identity: Identity,
    pub sender_name: String,
    pub text: String,
    pub created_at: Timestamp,
}

#[table(name = delete_message_schedule, scheduled(delete_message))]
struct DeleteMessageSchedule {
    #[primary_key]
    #[auto_inc]
    scheduled_id: u64,
    scheduled_at: ScheduleAt,
    message_id: u64,
}

#[table(name = purge_expired_schedule, scheduled(purge_expired_messages))]
struct PurgeExpiredSchedule {
    #[primary_key]
    #[auto_inc]
    scheduled_id: u64,
    scheduled_at: ScheduleAt,
}

/// Letzte Sendezeiten pro Identity (2/Min) — kein Scan über `chat_message`.
#[table(name = send_rate_state)]
struct SendRateState {
    #[primary_key]
    identity: Identity,
    send_at_1: Timestamp,
    send_at_2: Timestamp,
}

fn only_scheduler(ctx: &ReducerContext) -> bool {
    ctx.sender == ctx.identity()
}

fn char_allowed(c: char) -> bool {
    if c.is_ascii_alphanumeric() {
        return true;
    }
    matches!(c, 'Ä' | 'Ö' | 'Ü' | 'ä' | 'ö' | 'ü' | 'ß' | ' ' | ',' | '.' | '-')
}

fn text_is_allowed(s: &str) -> bool {
    s.chars().all(char_allowed)
}

fn within_char_limit(s: &str, max: usize) -> bool {
    s.chars().count() <= max
}

fn normalize_allowed_text(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn rate_window_start(now: Timestamp) -> Timestamp {
    now.checked_sub(rate_window()).unwrap_or(Timestamp::UNIX_EPOCH)
}

fn timestamp_in_rate_window(t: Timestamp, window_start: Timestamp) -> bool {
    t != Timestamp::UNIX_EPOCH && t >= window_start
}

fn count_sends_in_window(send_at_1: Timestamp, send_at_2: Timestamp, window_start: Timestamp) -> u32 {
    let mut count = 0u32;
    if timestamp_in_rate_window(send_at_1, window_start) {
        count += 1;
    }
    if timestamp_in_rate_window(send_at_2, window_start) {
        count += 1;
    }
    count
}

fn merge_rate_timestamps_after_send(
    send_at_1: Timestamp,
    send_at_2: Timestamp,
    now: Timestamp,
    window_start: Timestamp,
) -> (Timestamp, Timestamp) {
    let mut active: Vec<Timestamp> = Vec::new();
    if timestamp_in_rate_window(send_at_1, window_start) {
        active.push(send_at_1);
    }
    if timestamp_in_rate_window(send_at_2, window_start) {
        active.push(send_at_2);
    }
    active.push(now);
    active.sort();
    match active.len() {
        0 => (Timestamp::UNIX_EPOCH, Timestamp::UNIX_EPOCH),
        1 => (Timestamp::UNIX_EPOCH, active[0]),
        _ => {
            let n = active.len();
            (active[n - 2], active[n - 1])
        }
    }
}

fn is_rate_limited(ctx: &ReducerContext, sender: Identity) -> bool {
    let window_start = rate_window_start(ctx.timestamp);
    let state = ctx.db.send_rate_state();
    match state.identity().find(&sender) {
        Some(row) => {
            count_sends_in_window(row.send_at_1, row.send_at_2, window_start)
                >= MAX_MESSAGES_PER_WINDOW
        }
        None => false,
    }
}

fn record_rate_send(ctx: &ReducerContext, sender: Identity, now: Timestamp) {
    let window_start = rate_window_start(now);
    let table = ctx.db.send_rate_state();
    if let Some(mut row) = table.identity().find(&sender) {
        let (send_at_1, send_at_2) =
            merge_rate_timestamps_after_send(row.send_at_1, row.send_at_2, now, window_start);
        row.send_at_1 = send_at_1;
        row.send_at_2 = send_at_2;
        table.identity().update(row);
    } else {
        table.insert(SendRateState {
            identity: sender,
            send_at_1: Timestamp::UNIX_EPOCH,
            send_at_2: now,
        });
    }
}

fn ensure_purge_job(ctx: &ReducerContext) {
    if ctx.db.purge_expired_schedule().iter().next().is_some() {
        return;
    }
    ctx.db.purge_expired_schedule().insert(PurgeExpiredSchedule {
        scheduled_id: 0,
        scheduled_at: cleanup_interval().into(),
    });
}

fn schedule_message_deletion(ctx: &ReducerContext, message_id: u64, created_at: Timestamp) {
    let delete_at = created_at
        .checked_add(message_retention())
        .unwrap_or(created_at);
    ctx.db.delete_message_schedule().insert(DeleteMessageSchedule {
        scheduled_id: 0,
        scheduled_at: delete_at.into(),
        message_id,
    });
}

#[reducer(init)]
fn init(ctx: &ReducerContext) {
    ensure_purge_job(ctx);
}

#[reducer]
fn delete_message(ctx: &ReducerContext, arg: DeleteMessageSchedule) {
    if !only_scheduler(ctx) {
        log::warn!("delete_message: rejected non-scheduler caller {:?}", ctx.sender);
        return;
    }
    if ctx.db.chat_message().id().find(&arg.message_id).is_some() {
        ctx.db.chat_message().id().delete(&arg.message_id);
    }
}

#[reducer]
fn purge_expired_messages(ctx: &ReducerContext, _arg: PurgeExpiredSchedule) {
    if !only_scheduler(ctx) {
        log::warn!("purge_expired_messages: rejected non-scheduler caller {:?}", ctx.sender);
        return;
    }

    ensure_purge_job(ctx);

    let cutoff = ctx
        .timestamp
        .checked_sub(message_retention())
        .unwrap_or(Timestamp::UNIX_EPOCH);

    let to_delete: Vec<u64> = ctx
        .db
        .chat_message()
        .iter()
        .filter(|msg| msg.created_at < cutoff)
        .map(|msg| msg.id)
        .collect();

    let deleted = to_delete.len();
    for id in to_delete {
        ctx.db.chat_message().id().delete(&id);
    }

    if deleted > 0 {
        log::info!("purge_expired_messages: deleted {} message(s)", deleted);
    }
}

// 3. Lifecycle-Hook: Automatische Presence-Bereinigung bei Verbindungsabbruch
#[reducer(client_disconnected)]
pub fn identity_disconnected(ctx: &ReducerContext) {
    ctx.db.user_session().identity().delete(&ctx.sender);
    ctx.db.send_rate_state().identity().delete(&ctx.sender);
    log::info!("User getrennt: {:?}", ctx.sender);
}

// 4. Reducer: Raum betreten / URL wechseln
#[reducer]
pub fn join_room(ctx: &ReducerContext, url: String, username: String) {
    let clean_url = url.trim().to_string();
    if clean_url.is_empty() {
        return;
    }

    ensure_purge_job(ctx);

    let clean_username = username.trim().to_string();
    if clean_username.is_empty() || !text_is_allowed(&clean_username) {
        return;
    }
    let normalized_username = normalize_allowed_text(&clean_username);
    if normalized_username.is_empty() || !within_char_limit(&normalized_username, MAX_USERNAME_LEN) {
        return;
    }

    let sessions = ctx.db.user_session();
    if let Some(mut existing) = sessions.identity().find(&ctx.sender) {
        existing.current_url = clean_url;
        existing.username = normalized_username;
        existing.joined_at = ctx.timestamp;
        sessions.identity().update(existing);
    } else {
        sessions.insert(UserSession {
            identity: ctx.sender,
            current_url: clean_url,
            username: normalized_username,
            joined_at: ctx.timestamp,
        });
    }
}

// 5. Reducer: Raum verlassen
#[reducer]
pub fn leave_room(ctx: &ReducerContext) {
    ctx.db.user_session().identity().delete(&ctx.sender);
}

// 6. Reducer: Nachricht senden
#[reducer]
pub fn send_message(ctx: &ReducerContext, url: String, username: String, text: String) {
    let clean_text = text.trim().to_string();
    let clean_url = url.trim().to_string();

    if clean_text.is_empty() || clean_url.is_empty() {
        return;
    }

    if !text_is_allowed(&clean_text) {
        return;
    }
    let normalized_text = normalize_allowed_text(&clean_text);
    if normalized_text.is_empty() || !within_char_limit(&normalized_text, MAX_MESSAGE_TEXT_LEN) {
        return;
    }

    let clean_username = username.trim().to_string();
    if clean_username.is_empty() || !text_is_allowed(&clean_username) {
        return;
    }
    let normalized_username = normalize_allowed_text(&clean_username);
    if normalized_username.is_empty() || !within_char_limit(&normalized_username, MAX_USERNAME_LEN) {
        return;
    }

    ensure_purge_job(ctx);

    if is_rate_limited(ctx, ctx.sender) {
        return;
    }

    let row = ctx.db.chat_message().insert(ChatMessage {
        id: 0,
        url: clean_url,
        sender_identity: ctx.sender,
        sender_name: normalized_username,
        text: normalized_text,
        created_at: ctx.timestamp,
    });

    schedule_message_deletion(ctx, row.id, row.created_at);
    record_rate_send(ctx, ctx.sender, ctx.timestamp);
}

#[cfg(test)]
mod rate_window_tests {
    use super::*;

    fn ts(micros: i64) -> Timestamp {
        Timestamp::from_micros_since_unix_epoch(micros)
    }

    #[test]
    fn count_empty_slots() {
        let start = ts(100);
        assert_eq!(count_sends_in_window(Timestamp::UNIX_EPOCH, Timestamp::UNIX_EPOCH, start), 0);
    }

    #[test]
    fn count_one_in_window() {
        let start = ts(100);
        assert_eq!(count_sends_in_window(ts(150), Timestamp::UNIX_EPOCH, start), 1);
        assert_eq!(count_sends_in_window(ts(50), Timestamp::UNIX_EPOCH, start), 0);
    }

    #[test]
    fn count_two_in_window() {
        let start = ts(100);
        assert_eq!(count_sends_in_window(ts(110), ts(120), start), 2);
    }

    #[test]
    fn merge_keeps_two_newest_in_window() {
        let start = ts(0);
        let now = ts(200);
        let (a, b) = merge_rate_timestamps_after_send(ts(50), ts(150), now, start);
        assert_eq!(a, ts(150));
        assert_eq!(b, ts(200));
    }

    #[test]
    fn merge_drops_stale_outside_window() {
        let start = ts(100);
        let now = ts(200);
        let (a, b) = merge_rate_timestamps_after_send(ts(10), ts(150), now, start);
        assert_eq!(a, ts(150));
        assert_eq!(b, ts(200));
    }

    #[test]
    fn first_send_stores_in_send_at_2() {
        let start = ts(0);
        let now = ts(1_000_000);
        let (a, b) = merge_rate_timestamps_after_send(
            Timestamp::UNIX_EPOCH,
            Timestamp::UNIX_EPOCH,
            now,
            start,
        );
        assert_eq!(a, Timestamp::UNIX_EPOCH);
        assert_eq!(b, now);
    }
}

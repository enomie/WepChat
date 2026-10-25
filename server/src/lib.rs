// Rate limit (send_rate_state) & retention: docs/requirements/security-list.md §1 + §6
// Message charset: docs/requirements/message-content.md
// Query patterns: docs/requirements/server-query-patterns.md
use std::collections::HashSet;

use spacetimedb::{
    reducer, table, Identity, ReducerContext, ScheduleAt, Table, TimeDuration, Timestamp,
};

const MAX_MESSAGES_PER_WINDOW: u32 = 2;
const MIN_USERNAME_LEN: usize = 2;
const MAX_USERNAME_LEN: usize = 13;
const MAX_MESSAGE_TEXT_LEN: usize = 400;
const MAX_URL_LEN: usize = 2048;

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
    #[default(1u8)]
    pub nick_color: u8,
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
    #[default(1u8)]
    pub sender_nick_color: u8,
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

/// Letzte Sendezeiten pro Identity (2/Min), kein Scan über `chat_message`.
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

// docs/requirements/url-eligibility.md — keep in sync with extension/src/lib/url-utils.ts
fn extract_host_from_http_url(url: &str) -> Option<&str> {
    let trimmed = url.trim();
    let lower = trimmed.to_ascii_lowercase();
    let after_scheme = if lower.starts_with("https://") {
        trimmed.get(8..)?
    } else if lower.starts_with("http://") {
        trimmed.get(7..)?
    } else {
        return None;
    };

    if after_scheme.is_empty() {
        return None;
    }

    if after_scheme.starts_with('[') {
        let end = after_scheme.find(']')?;
        return after_scheme.get(1..end);
    }

    let end = after_scheme
        .find(|c| c == '/' || c == '?' || c == '#')
        .unwrap_or(after_scheme.len());
    let host_with_port = after_scheme.get(..end)?;
    let host = host_with_port
        .rsplit_once(':')
        .filter(|(h, port)| !h.contains(':') && port.chars().all(|c| c.is_ascii_digit()))
        .map(|(h, _)| h)
        .unwrap_or(host_with_port);
    if host.is_empty() {
        None
    } else {
        Some(host)
    }
}

fn parse_ipv4_octets(host: &str) -> Option<[u8; 4]> {
    let parts: Vec<&str> = host.split('.').collect();
    if parts.len() != 4 {
        return None;
    }
    let mut octets = [0u8; 4];
    for (i, part) in parts.iter().enumerate() {
        if part.is_empty() || part.len() > 3 || !part.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        let n: u16 = part.parse().ok()?;
        if n > 255 {
            return None;
        }
        octets[i] = n as u8;
    }
    Some(octets)
}

fn host_is_public_chat_host(host: &str) -> bool {
    let h = host.to_ascii_lowercase();

    if h == "localhost" || h == "localhost.localdomain" || h == "0.0.0.0" {
        return false;
    }

    if h.contains(':') {
        if h == "::1" {
            return false;
        }
        if h.starts_with("fe80:") {
            return false;
        }
        if h.starts_with("fc") || h.starts_with("fd") {
            return false;
        }
        return true;
    }

    if let Some([a, b, _, _]) = parse_ipv4_octets(&h) {
        if a == 127 {
            return false;
        }
        if a == 10 {
            return false;
        }
        if a == 172 && (16..=31).contains(&b) {
            return false;
        }
        if a == 192 && b == 168 {
            return false;
        }
        if a == 169 && b == 254 {
            return false;
        }
    }

    true
}

fn url_allowed_for_chat(url: &str) -> bool {
    if url.len() > MAX_URL_LEN {
        return false;
    }
    match extract_host_from_http_url(url) {
        Some(host) => host_is_public_chat_host(host),
        None => false,
    }
}

fn normalize_allowed_text(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn normalize_nick_color(raw: u8) -> u8 {
    if raw >= 1 && raw <= 9 {
        raw
    } else {
        1
    }
}

fn username_key_ci(s: &str) -> String {
    s.to_lowercase()
}

fn username_eq_ci(a: &str, b: &str) -> bool {
    username_key_ci(a) == username_key_ci(b)
}

/// Spec: room-pseudonym.md §2.5 — shrink `wish` from the end so `base + suffix` fits in `max_len`.
fn make_suffixed_display_name(wish: &str, suffix_n: u32, max_len: usize) -> Option<String> {
    let suffix = suffix_n.to_string();
    let suffix_len = suffix.chars().count();
    if suffix_len >= max_len {
        return None;
    }
    let max_base_len = max_len - suffix_len;
    if max_base_len < 1 {
        return None;
    }
    let base: String = wish.chars().take(max_base_len).collect();
    if base.is_empty() {
        return None;
    }
    Some(format!("{base}{suffix}"))
}

/// `taken_lower`: occupied display names in the room (case-insensitive keys).
fn assign_room_display_name(wish: &str, taken_lower: &HashSet<String>) -> Option<String> {
    let wish_key = username_key_ci(wish);
    if !taken_lower.contains(&wish_key) {
        return Some(wish.to_string());
    }
    for n in 2..=999_999u32 {
        let candidate = make_suffixed_display_name(wish, n, MAX_USERNAME_LEN)?;
        if !taken_lower.contains(&username_key_ci(&candidate)) {
            return Some(candidate);
        }
    }
    None
}

fn nick_color_for_sender(ctx: &ReducerContext, sender: Identity) -> u8 {
    ctx.db
        .user_session()
        .identity()
        .find(&sender)
        .map(|s| normalize_nick_color(s.nick_color))
        .unwrap_or(1)
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

/// User deletes own row only (`ctx.sender`); see docs/requirements/delete-messages.md §3.2.
#[reducer]
pub fn delete_own_message(ctx: &ReducerContext, message_id: u64) {
    let Some(msg) = ctx.db.chat_message().id().find(&message_id) else {
        return;
    };
    if msg.sender_identity != ctx.sender {
        return;
    }
    ctx.db.chat_message().id().delete(&message_id);
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
pub fn join_room(ctx: &ReducerContext, url: String, username: String, nick_color: u8) {
    let clean_url = url.trim().to_string();
    if clean_url.is_empty() || !url_allowed_for_chat(&clean_url) {
        return;
    }

    ensure_purge_job(ctx);

    let clean_username = username.trim().to_string();
    if clean_username.is_empty() || !text_is_allowed(&clean_username) {
        return;
    }
    let normalized_username = normalize_allowed_text(&clean_username);
    let name_len = normalized_username.chars().count();
    if normalized_username.is_empty()
        || name_len < MIN_USERNAME_LEN
        || !within_char_limit(&normalized_username, MAX_USERNAME_LEN)
    {
        return;
    }

    let color = normalize_nick_color(nick_color);

    let sessions = ctx.db.user_session();
    let mut taken = HashSet::new();
    for session in sessions.iter() {
        if session.current_url == clean_url && session.identity != ctx.sender {
            taken.insert(username_key_ci(&session.username));
        }
    }

    let display_name = match assign_room_display_name(&normalized_username, &taken) {
        Some(name) => name,
        None => return,
    };
    if !within_char_limit(&display_name, MAX_USERNAME_LEN) {
        return;
    }

    if let Some(mut existing) = sessions.identity().find(&ctx.sender) {
        existing.current_url = clean_url;
        existing.username = display_name;
        existing.nick_color = color;
        existing.joined_at = ctx.timestamp;
        sessions.identity().update(existing);
    } else {
        sessions.insert(UserSession {
            identity: ctx.sender,
            current_url: clean_url,
            username: display_name,
            joined_at: ctx.timestamp,
            nick_color: color,
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

    if clean_text.is_empty() || clean_url.is_empty() || !url_allowed_for_chat(&clean_url) {
        return;
    }

    if !text_is_allowed(&clean_text) {
        return;
    }
    let normalized_text = normalize_allowed_text(&clean_text);
    if normalized_text.is_empty() || !within_char_limit(&normalized_text, MAX_MESSAGE_TEXT_LEN) {
        return;
    }

    let _ = username;

    ensure_purge_job(ctx);

    let sessions = ctx.db.user_session();
    let session = sessions.identity().find(&ctx.sender);
    let Some(session) = session else {
        return;
    };

    if session.current_url != clean_url {
        return;
    }

    if is_rate_limited(ctx, ctx.sender) {
        return;
    }

    let sender_nick_color = nick_color_for_sender(ctx, ctx.sender);

    let row = ctx.db.chat_message().insert(ChatMessage {
        id: 0,
        url: clean_url,
        sender_identity: ctx.sender,
        sender_name: session.username.clone(),
        text: normalized_text,
        created_at: ctx.timestamp,
        sender_nick_color,
    });

    schedule_message_deletion(ctx, row.id, row.created_at);
    record_rate_send(ctx, ctx.sender, ctx.timestamp);
}

#[cfg(test)]
mod url_eligibility_tests {
    use super::*;

    #[test]
    fn blocks_localhost_and_private_hosts() {
        assert!(!url_allowed_for_chat("http://localhost:3000/"));
        assert!(!url_allowed_for_chat("http://localhost.localdomain/"));
        assert!(!url_allowed_for_chat("http://127.0.0.1/"));
        assert!(!url_allowed_for_chat("http://192.168.0.1/"));
        assert!(!url_allowed_for_chat("http://[::1]/"));
        assert!(!url_allowed_for_chat("chrome://settings"));
    }

    #[test]
    fn allows_public_https() {
        assert!(url_allowed_for_chat("https://example.com/path"));
        assert!(url_allowed_for_chat("https://localhost.example.com/"));
        assert!(url_allowed_for_chat("http://172.15.0.1/"));
    }

    #[test]
    fn enforces_max_url_len() {
        let base = "https://example.com/?p=";
        let pad_2048 = format!("{}{}", base, "a".repeat(2048 - base.len()));
        assert_eq!(pad_2048.len(), 2048);
        assert!(url_allowed_for_chat(&pad_2048));

        let pad_2049 = format!("{}{}", base, "a".repeat(2049 - base.len()));
        assert_eq!(pad_2049.len(), 2049);
        assert!(!url_allowed_for_chat(&pad_2049));
    }
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
    fn nick_color_valid_range_unchanged() {
        for id in 1u8..=9 {
            assert_eq!(normalize_nick_color(id), id);
        }
    }

    #[test]
    fn nick_color_invalid_defaults_to_blue() {
        assert_eq!(normalize_nick_color(0), 1);
        assert_eq!(normalize_nick_color(10), 1);
        assert_eq!(normalize_nick_color(255), 1);
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

#[cfg(test)]
mod room_pseudonym_tests {
    use super::*;

    fn taken(names: &[&str]) -> HashSet<String> {
        names.iter().map(|n| username_key_ci(n)).collect()
    }

    #[test]
    fn assign_free_wish_unchanged() {
        let got = assign_room_display_name("Kurt", &taken(&[])).unwrap();
        assert_eq!(got, "Kurt");
    }

    #[test]
    fn assign_second_kurt_gets_suffix_2() {
        let got = assign_room_display_name("Kurt", &taken(&["Kurt"])).unwrap();
        assert_eq!(got, "Kurt2");
    }

    #[test]
    fn assign_third_kurt_gets_suffix_3() {
        let got = assign_room_display_name("Kurt", &taken(&["Kurt", "Kurt2"])).unwrap();
        assert_eq!(got, "Kurt3");
    }

    #[test]
    fn assign_case_insensitive_collision() {
        let got = assign_room_display_name("kurt", &taken(&["Kurt"])).unwrap();
        assert_eq!(got, "kurt2");
    }

    #[test]
    fn assign_literal_kurt2_when_free() {
        let got = assign_room_display_name("Kurt2", &taken(&[])).unwrap();
        assert_eq!(got, "Kurt2");
    }

    #[test]
    fn username_eq_ci_works() {
        assert!(username_eq_ci("Kurt", "kurt"));
        assert!(!username_eq_ci("Kurt", "Kurt2"));
    }

    #[test]
    fn wish_username_must_be_at_least_min_len() {
        let one = normalize_allowed_text("A");
        assert_eq!(one.chars().count(), 1);
        assert!(one.chars().count() < MIN_USERNAME_LEN);
        let two = normalize_allowed_text("AB");
        assert_eq!(two.chars().count(), MIN_USERNAME_LEN);
    }

    #[test]
    fn suffixed_name_truncates_base_for_length() {
        let long = "Abcdefghijklm";
        assert_eq!(long.chars().count(), 13);
        let got = make_suffixed_display_name(long, 2, MAX_USERNAME_LEN).unwrap();
        assert_eq!(got.chars().count(), 13);
        assert!(got.ends_with('2'));
        assert_eq!(got, "Abcdefghijkl2");
    }

    #[test]
    fn suffixed_name_two_digit_suffix() {
        let wish = "Abcdefghijk";
        let got = make_suffixed_display_name(wish, 10, MAX_USERNAME_LEN).unwrap();
        assert_eq!(got, "Abcdefghijk10");
        assert_eq!(got.chars().count(), 13);
    }
}

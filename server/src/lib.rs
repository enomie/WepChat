// Rate limit & retention: docs/requirements/security-list.md §1 + §6
use spacetimedb::{
    reducer, table, Identity, ReducerContext, ScheduleAt, Table, TimeDuration, Timestamp,
};

const MAX_MESSAGES_PER_WINDOW: u32 = 2;

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

fn only_scheduler(ctx: &ReducerContext) -> bool {
    ctx.sender == ctx.identity()
}

fn count_recent_messages(ctx: &ReducerContext, sender: Identity) -> u32 {
    let window_start = ctx
        .timestamp
        .checked_sub(rate_window())
        .unwrap_or(Timestamp::UNIX_EPOCH);
    let mut count = 0u32;
    for msg in ctx.db.chat_message().iter() {
        if msg.sender_identity == sender && msg.created_at >= window_start {
            count += 1;
            if count >= MAX_MESSAGES_PER_WINDOW {
                break;
            }
        }
    }
    count
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

    let sessions = ctx.db.user_session();
    if let Some(mut existing) = sessions.identity().find(&ctx.sender) {
        existing.current_url = clean_url;
        existing.username = username;
        existing.joined_at = ctx.timestamp;
        sessions.identity().update(existing);
    } else {
        sessions.insert(UserSession {
            identity: ctx.sender,
            current_url: clean_url,
            username,
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

    ensure_purge_job(ctx);

    if count_recent_messages(ctx, ctx.sender) >= MAX_MESSAGES_PER_WINDOW {
        return;
    }

    let row = ctx.db.chat_message().insert(ChatMessage {
        id: 0,
        url: clean_url,
        sender_identity: ctx.sender,
        sender_name: username,
        text: clean_text,
        created_at: ctx.timestamp,
    });

    schedule_message_deletion(ctx, row.id, row.created_at);
}

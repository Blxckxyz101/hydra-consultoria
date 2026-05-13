import { pgTable, text, timestamp, serial, boolean, jsonb, index, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const infinityUsersTable = pgTable("infinity_users", {
  username:         text("username").primaryKey(),
  passwordHash:     text("password_hash").notNull(),
  role:             text("role").notNull().default("user"),
  displayName:      text("display_name"),
  accountPin:       text("account_pin"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt:      timestamp("last_login_at", { withTimezone: true }),
  accountExpiresAt: timestamp("account_expires_at", { withTimezone: true }),
  queryDailyLimit:  integer("query_daily_limit"),
  // Profile fields (synced to DB)
  profilePhoto:     text("profile_photo"),
  profileBanner:    text("profile_banner"),
  profileBio:       text("profile_bio"),
  profileStatus:    text("profile_status").default("online"),
  profileStatusMsg: text("profile_status_msg"),
  hideUsername:     boolean("hide_username").notNull().default(false),
  // Social profile extensions
  profileLocation:    text("profile_location"),
  profileMusicUrl:    text("profile_music_url"),
  profileSocialLinks: jsonb("profile_social_links"),
  profileViews:       integer("profile_views").notNull().default(0),
  profileAccentColor: text("profile_accent_color"),
  profileBgType:      text("profile_bg_type").default("default"),
  profileBgValue:     text("profile_bg_value"),
  // Timestamp used for cache-busting profile image URLs
  profileUpdatedAt:   timestamp("profile_updated_at", { withTimezone: true }),
  // Plan & card theme
  planType:           text("plan_type").default("free"),        // "free" | "pro"
  planTier:           text("plan_tier").notNull().default("free"), // "free" | "padrao" | "vip" | "ultra"
  planExpiresAt:      timestamp("plan_expires_at", { withTimezone: true }),
  cardTheme:          text("card_theme").default("default"),    // theme slug
  // 2FA TOTP
  totpSecret:         text("totp_secret"),
  totpEnabled:        boolean("totp_enabled").notNull().default(false),
  // Credits & plan quota
  creditBalance:      integer("credit_balance").notNull().default(0),
  planQueryQuota:     integer("plan_query_quota"),           // null = no active quota
  planQueriesUsed:    integer("plan_queries_used").notNull().default(0),
});

export const infinitySessionsTable = pgTable("infinity_sessions", {
  token:     text("token").primaryKey(),
  username:  text("username").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const infinityConsultasTable = pgTable(
  "infinity_consultas",
  {
    id:        serial("id").primaryKey(),
    tipo:      text("tipo").notNull(),
    query:     text("query").notNull(),
    username:  text("username").notNull(),
    success:   boolean("success").notNull().default(false),
    result:    jsonb("result"),
    skylers:   boolean("skylers").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUser: index("infinity_consultas_user_idx").on(t.username),
    byCreated: index("infinity_consultas_created_idx").on(t.createdAt),
  }),
);

export const infinityPinsTable = pgTable("infinity_pins", {
  pin:       text("pin").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by").notNull(),
  usedAt:    timestamp("used_at", { withTimezone: true }),
  usedBy:    text("used_by"),
});

// ─── Payment + Pending Account tables ────────────────────────────────────────

export const infinityPaymentsTable = pgTable(
  "infinity_payments",
  {
    id:                  text("id").primaryKey(),
    username:            text("username"),
    planId:              text("plan_id").notNull(),
    amountCents:         integer("amount_cents").notNull(),
    originalAmountCents: integer("original_amount_cents"),   // set when a coupon is applied
    couponCode:          text("coupon_code"),                 // coupon used (if any)
    status:              text("status").notNull().default("pending"),
    nedpayId:            text("nedpay_id"),
    pixCode:             text("pix_code"),
    pixQr:               text("pix_qr"),
    expiresAt:           timestamp("expires_at", { withTimezone: true }),
    paidAt:              timestamp("paid_at", { withTimezone: true }),
    createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Purpose field for multi-use payments
    purpose:             text("purpose").notNull().default("subscription"),
    purposeMeta:         text("purpose_meta"),
  },
  (t) => ({
    byUsername: index("infinity_payments_username_idx").on(t.username),
    byStatus:   index("infinity_payments_status_idx").on(t.status),
  }),
);

export const infinityPendingAccountsTable = pgTable(
  "infinity_pending_accounts",
  {
    id:           serial("id").primaryKey(),
    username:     text("username").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    email:        text("email"),
    planId:       text("plan_id").notNull(),
    paymentId:    text("payment_id").notNull(),
    status:       text("status").notNull().default("pending_payment"),
    rejectedReason: text("rejected_reason"),
    referredBy:   text("referred_by"),
    createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStatus: index("infinity_pending_accounts_status_idx").on(t.status),
  }),
);

// ─── Wallet ────────────────────────────────────────────────────────────────────

export const infinityWalletTable = pgTable("infinity_wallet", {
  username:     text("username").primaryKey(),
  balanceCents: integer("balance_cents").notNull().default(0),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const infinityWalletTxnsTable = pgTable(
  "infinity_wallet_txns",
  {
    id:          serial("id").primaryKey(),
    username:    text("username").notNull(),
    direction:   text("direction").notNull(), // "credit" | "debit"
    amountCents: integer("amount_cents").notNull(),
    description: text("description").notNull(),
    refId:       text("ref_id"),
    createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUser: index("infinity_wallet_txns_user_idx").on(t.username),
  }),
);

// ─── Gift Cards ────────────────────────────────────────────────────────────────

export const infinityGiftPurchasesTable = pgTable(
  "infinity_gift_purchases",
  {
    id:            serial("id").primaryKey(),
    username:      text("username").notNull(),
    packId:        text("pack_id").notNull(),
    codesCount:    integer("codes_count").notNull(),
    amountCents:   integer("amount_cents").notNull(),
    paymentMethod: text("payment_method").notNull(), // "pix" | "wallet"
    paymentId:     text("payment_id"),
    status:        text("status").notNull().default("pending"), // "pending" | "completed" | "cancelled"
    completedAt:   timestamp("completed_at", { withTimezone: true }),
    createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUser:   index("infinity_gift_purchases_user_idx").on(t.username),
    byStatus: index("infinity_gift_purchases_status_idx").on(t.status),
  }),
);

export const infinityGiftCodesTable = pgTable(
  "infinity_gift_codes",
  {
    code:        text("code").primaryKey(), // INFY-XXXX-XXXX-XXXX
    packId:      text("pack_id").notNull(),
    days:        integer("days").notNull(),
    ownedBy:     text("owned_by").notNull(),
    purchaseId:  integer("purchase_id").notNull(),
    redeemedBy:  text("redeemed_by"),
    redeemedAt:  timestamp("redeemed_at", { withTimezone: true }),
    expiresAt:   timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byOwner:    index("infinity_gift_codes_owner_idx").on(t.ownedBy),
    byPurchase: index("infinity_gift_codes_purchase_idx").on(t.purchaseId),
  }),
);

// ─── Profile Presets ─────────────────────────────────────────────────────────

export const infinityProfilePresetsTable = pgTable(
  "infinity_profile_presets",
  {
    id:        serial("id").primaryKey(),
    username:  text("username").notNull(),
    name:      text("name").notNull(),
    theme:     text("theme"),
    photo:     text("photo"),
    banner:    text("banner"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUser: index("infinity_profile_presets_user_idx").on(t.username),
  }),
);

export type InfinityProfilePresetRow = typeof infinityProfilePresetsTable.$inferSelect;

// ─── Notifications ───────────────────────────────────────────────────────────

export const infinityNotificationsTable = pgTable(
  "infinity_notifications",
  {
    id:          text("id").primaryKey(),
    title:       text("title").notNull(),
    body:        text("body").notNull(),
    imageUrl:    text("image_url"),
    authorName:  text("author_name").notNull(),
    createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byCreated: index("infinity_notifications_created_idx").on(t.createdAt),
  }),
);

export type InfinityNotificationRow = typeof infinityNotificationsTable.$inferSelect;

// ─── Referrals ─────────────────────────────────────────────────────────────────

export const infinityReferralsTable = pgTable(
  "infinity_referrals",
  {
    id:               serial("id").primaryKey(),
    referrerUsername: text("referrer_username").notNull(),
    referredUsername: text("referred_username").notNull().unique(),
    bonusDays:        integer("bonus_days").notNull().default(7),
    appliedAt:        timestamp("applied_at", { withTimezone: true }),
    createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byReferrer: index("infinity_referrals_referrer_idx").on(t.referrerUsername),
  }),
);

// ─── Friendships ─────────────────────────────────────────────────────────────

export const infinityFriendshipsTable = pgTable(
  "infinity_friendships",
  {
    id:                serial("id").primaryKey(),
    requesterUsername: text("requester_username").notNull(),
    addresseeUsername: text("addressee_username").notNull(),
    status:            text("status").notNull().default("pending"),
    createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byRequester: index("infinity_friendships_requester_idx").on(t.requesterUsername),
    byAddressee: index("infinity_friendships_addressee_idx").on(t.addresseeUsername),
  }),
);

export type InfinityFriendshipRow = typeof infinityFriendshipsTable.$inferSelect;

// ─── Chat Rooms ───────────────────────────────────────────────────────────────

export const infinityChatRoomsTable = pgTable(
  "infinity_chat_rooms",
  {
    id:          serial("id").primaryKey(),
    slug:        text("slug").unique().notNull(),
    name:        text("name").notNull(),
    type:        text("type").notNull().default("public"),
    createdBy:   text("created_by").notNull(),
    description: text("description"),
    icon:        text("icon"),
    createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bySlug:    index("infinity_chat_rooms_slug_idx").on(t.slug),
    byCreator: index("infinity_chat_rooms_creator_idx").on(t.createdBy),
  }),
);

export type InfinityChatRoomRow = typeof infinityChatRoomsTable.$inferSelect;

// ─── Chat Messages ────────────────────────────────────────────────────────────

export const infinityChatMessagesTable = pgTable(
  "infinity_chat_messages",
  {
    id:              serial("id").primaryKey(),
    roomSlug:        text("room_slug").notNull(),
    username:        text("username").notNull(),
    content:         text("content").notNull(),
    replyToId:       integer("reply_to_id"),
    replyToUsername: text("reply_to_username"),
    replyToContent:  text("reply_to_content"),
    createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byRoom:    index("infinity_chat_messages_room_idx").on(t.roomSlug),
    byCreated: index("infinity_chat_messages_created_idx").on(t.createdAt),
  }),
);

export type InfinityChatMessageRow = typeof infinityChatMessagesTable.$inferSelect;

// ─── Message Reactions ────────────────────────────────────────────────────────

export const infinityMessageReactionsTable = pgTable(
  "infinity_message_reactions",
  {
    id:        serial("id").primaryKey(),
    messageId: integer("message_id").notNull(),
    username:  text("username").notNull(),
    emoji:     text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byMessage: index("infinity_message_reactions_msg_idx").on(t.messageId),
    byUser:    index("infinity_message_reactions_user_idx").on(t.username),
  }),
);

export type InfinityMessageReactionRow = typeof infinityMessageReactionsTable.$inferSelect;

// ─── User Notifications (personal) ───────────────────────────────────────────

export const infinityUserNotificationsTable = pgTable(
  "infinity_user_notifications",
  {
    id:        serial("id").primaryKey(),
    username:  text("username").notNull(),       // recipient
    type:      text("type").notNull(),           // "friend_request" | "friend_accept" | "dm" | "reaction" | "system"
    fromUser:  text("from_user"),               // who triggered it
    data:      jsonb("data"),                   // extra info (messageId, roomSlug, etc.)
    read:      boolean("read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUser:    index("infinity_user_notifs_user_idx").on(t.username),
    byRead:    index("infinity_user_notifs_read_idx").on(t.read),
    byCreated: index("infinity_user_notifs_created_idx").on(t.createdAt),
  }),
);

export type InfinityUserNotificationRow = typeof infinityUserNotificationsTable.$inferSelect;

// ─── AI Chat Sessions ─────────────────────────────────────────────────────────

export const infinityAiSessionsTable = pgTable(
  "infinity_ai_sessions",
  {
    id:        text("id").primaryKey(),
    username:  text("username").notNull(),
    title:     text("title").notNull().default("Nova conversa"),
    messages:  jsonb("messages").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byUser:    index("infinity_ai_sessions_user_idx").on(t.username),
    byUpdated: index("infinity_ai_sessions_updated_idx").on(t.updatedAt),
  }),
);

export type InfinityAiSessionRow = typeof infinityAiSessionsTable.$inferSelect;

// ─── Dossiers ─────────────────────────────────────────────────────────────────

export const infinityDossiesTable = pgTable(
  "infinity_dossies",
  {
    id:        text("id").primaryKey(),
    username:  text("username").notNull(),
    title:     text("title").notNull(),
    items:     jsonb("items").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byUser: index("infinity_dossies_user_idx").on(t.username),
  }),
);

export type InfinityDossieRow = typeof infinityDossiesTable.$inferSelect;

// ─── Chat Images (persistent, 24h TTL) ───────────────────────────────────────

export const infinityChatImagesTable = pgTable(
  "infinity_chat_images",
  {
    id:        text("id").primaryKey(),
    username:  text("username").notNull(),
    mimeType:  text("mime_type").notNull(),
    data:      text("data").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byExpires: index("infinity_chat_images_expires_idx").on(t.expiresAt),
  }),
);

export type InfinityChatImageRow = typeof infinityChatImagesTable.$inferSelect;

// ─── Favoritos ────────────────────────────────────────────────────────────────

export const infinityFavoritosTable = pgTable(
  "infinity_favoritos",
  {
    id:        text("id").primaryKey(),
    username:  text("username").notNull(),
    tipo:      text("tipo").notNull(),
    query:     text("query").notNull(),
    note:      text("note").notNull().default(""),
    fields:    jsonb("fields").notNull().default([]),
    sections:  jsonb("sections").notNull().default([]),
    raw:       text("raw").notNull().default(""),
    addedAt:   timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUser: index("infinity_favoritos_user_idx").on(t.username),
  }),
);

export type InfinityFavoritoRow = typeof infinityFavoritosTable.$inferSelect;

// ─── Coupons ──────────────────────────────────────────────────────────────────

export const infinityCouponsTable = pgTable("infinity_coupons", {
  code:            text("code").primaryKey(),          // uppercase unique code e.g. HYDRA20
  discountPercent: integer("discount_percent").notNull(), // 1–100
  maxUses:         integer("max_uses"),                 // null = unlimited
  usedCount:       integer("used_count").notNull().default(0),
  expiresAt:       timestamp("expires_at", { withTimezone: true }), // null = never expires
  active:          boolean("active").notNull().default(true),
  description:     text("description"),
  createdBy:       text("created_by").notNull(),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InfinityCouponRow = typeof infinityCouponsTable.$inferSelect;

// ─── Exports ──────────────────────────────────────────────────────────────────

export const insertInfinityUserSchema = createInsertSchema(infinityUsersTable);
export type InsertInfinityUser        = z.infer<typeof insertInfinityUserSchema>;
export type InfinityUserRow           = typeof infinityUsersTable.$inferSelect;
export type InfinitySessionRow        = typeof infinitySessionsTable.$inferSelect;
export type InfinityConsultaRow       = typeof infinityConsultasTable.$inferSelect;
export type InfinityPinRow            = typeof infinityPinsTable.$inferSelect;
export type InfinityPaymentRow        = typeof infinityPaymentsTable.$inferSelect;
export type InfinityPendingAccountRow = typeof infinityPendingAccountsTable.$inferSelect;
export type InfinityWalletRow         = typeof infinityWalletTable.$inferSelect;
export type InfinityGiftCodeRow       = typeof infinityGiftCodesTable.$inferSelect;
export type InfinityGiftPurchaseRow   = typeof infinityGiftPurchasesTable.$inferSelect;
export type InfinityReferralRow       = typeof infinityReferralsTable.$inferSelect;

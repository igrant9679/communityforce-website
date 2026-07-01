import { int, json, mysqlEnum, mysqlTable, primaryKey, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Stable identity key. Local accounts use "local:<username>"; legacy Manus OAuth users keep their openId. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  /** Local username/password auth. Null for legacy OAuth-only accounts. */
  username: varchar("username", { length: 64 }).unique(),
  passwordHash: varchar("passwordHash", { length: 255 }),
  role: mysqlEnum("role", ["admin", "editor", "author", "contributor", "subscriber"]).default("subscriber").notNull(),
  // Profile fields
  bio: text("bio"),
  avatar: varchar("avatar", { length: 500 }),
  twitterUrl: varchar("twitterUrl", { length: 255 }),
  linkedinUrl: varchar("linkedinUrl", { length: 255 }),
  githubUrl: varchar("githubUrl", { length: 255 }),
  websiteUrl: varchar("websiteUrl", { length: 255 }),
  // Notification preferences
  notifyComments: int("notifyComments").default(1).notNull(), // 1 = enabled, 0 = disabled
  notifyApprovals: int("notifyApprovals").default(1).notNull(),
  notifyMentions: int("notifyMentions").default(1).notNull(),
  notifySystem: int("notifySystem").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Blog posts table for content management system.
 * Supports draft/published workflow with rich markdown content.
 */
export const blogPosts = mysqlTable("blog_posts", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  excerpt: text("excerpt"),
  content: text("content").notNull(),
  coverImage: varchar("coverImage", { length: 500 }),
  authorId: int("authorId").notNull().references(() => users.id),
  status: mysqlEnum("status", ["draft", "published", "scheduled", "archived"]).default("draft").notNull(),
  publishedAt: timestamp("publishedAt"),
  scheduledPublishAt: timestamp("scheduledPublishAt"),
  tags: varchar("tags", { length: 500 }),
  metaDescription: varchar("metaDescription", { length: 160 }),
  readTimeMinutes: int("readTimeMinutes"),
  // SEO metadata fields
  metaTitle: varchar("metaTitle", { length: 60 }),
  ogTitle: varchar("ogTitle", { length: 60 }),
  ogDescription: varchar("ogDescription", { length: 160 }),
  ogImage: varchar("ogImage", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BlogPost = typeof blogPosts.$inferSelect;
export type InsertBlogPost = typeof blogPosts.$inferInsert;

/**
 * Blog categories for organizing content.
 */
export const blogCategories = mysqlTable("blog_categories", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  description: text("description"),
  parentId: int("parentId"), // Self-reference for hierarchical categories
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type BlogCategory = typeof blogCategories.$inferSelect;
export type InsertBlogCategory = typeof blogCategories.$inferInsert;

/**
 * Blog tags for fine-grained content classification.
 */
export const blogTags = mysqlTable("blog_tags", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 50 }).notNull().unique(),
  slug: varchar("slug", { length: 50 }).notNull().unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type BlogTag = typeof blogTags.$inferSelect;
export type InsertBlogTag = typeof blogTags.$inferInsert;

/**
 * Junction table for blog post categories (many-to-many).
 */
export const blogPostCategories = mysqlTable("blog_post_categories", {
  blogPostId: int("blogPostId").notNull().references(() => blogPosts.id, { onDelete: "cascade" }),
  categoryId: int("categoryId").notNull().references(() => blogCategories.id, { onDelete: "cascade" }),
}, (table) => ({
  pk: primaryKey({ columns: [table.blogPostId, table.categoryId] }),
}));

/**
 * Junction table for blog post tags (many-to-many).
 */
export const blogPostTags = mysqlTable("blog_post_tags", {
  blogPostId: int("blogPostId").notNull().references(() => blogPosts.id, { onDelete: "cascade" }),
  tagId: int("tagId").notNull().references(() => blogTags.id, { onDelete: "cascade" }),
}, (table) => ({
  pk: primaryKey({ columns: [table.blogPostId, table.tagId] }),
}));

/**
 * Page views tracking table for analytics.
 * Records each page view with visitor information.
 */
export const auditLogs = mysqlTable("audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  action: varchar("action", { length: 100 }).notNull(), // e.g., "blog:create", "blog:update", "user:role_change"
  entityType: varchar("entity_type", { length: 50 }).notNull(), // e.g., "blog_post", "cms_page", "user"
  entityId: int("entity_id"), // ID of the affected entity
  details: json("details"), // Additional context (old values, new values, etc.)
  ipAddress: varchar("ip_address", { length: 45 }), // Support IPv6
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;

export const pageViews = mysqlTable("page_views", {
  id: int("id").autoincrement().primaryKey(),
  pageId: int("pageId").notNull(),
  pageType: mysqlEnum("pageType", ["blog", "cms"]).notNull(),
  visitorId: varchar("visitorId", { length: 255 }).notNull(), // Cookie-based visitor ID
  sessionId: varchar("sessionId", { length: 255 }).notNull(),
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),
  referrer: text("referrer"),
  viewedAt: timestamp("viewedAt").defaultNow().notNull(),
});

export type PageView = typeof pageViews.$inferSelect;
export type InsertPageView = typeof pageViews.$inferInsert;

/**
 * CMS pages table for managing all website pages.
 * Allows creating and editing any page content through admin interface.
 */
export const pageVersions = mysqlTable("page_versions", {
  id: int("id").primaryKey().autoincrement(),
  pageId: int("pageId").notNull().references(() => cmsPages.id, { onDelete: 'cascade' }),
  versionNumber: int("versionNumber").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull(),
  content: text("content").notNull(),
  metaDescription: varchar("metaDescription", { length: 160 }),
  metaKeywords: varchar("metaKeywords", { length: 255 }),
  status: mysqlEnum("status", ["draft", "published", "scheduled", "archived"]).notNull(),
  template: varchar("template", { length: 50 }),
  authorId: int("authorId").notNull().references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  createdBy: int("createdBy").notNull().references(() => users.id),
});

export const cmsPages = mysqlTable("cms_pages", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  content: text("content").notNull(),
  metaDescription: varchar("metaDescription", { length: 160 }),
  metaKeywords: varchar("metaKeywords", { length: 255 }),
  status: mysqlEnum("status", ["draft", "published", "scheduled", "archived"]).default("draft").notNull(),
  template: varchar("template", { length: 50 }).default("default"),
  authorId: int("authorId").notNull().references(() => users.id),
  publishedAt: timestamp("publishedAt"),
  scheduledPublishAt: timestamp("scheduledPublishAt"),
  displayOrder: int("displayOrder").default(0),
  previewToken: varchar("previewToken", { length: 255 }),
  previewExpiresAt: timestamp("previewExpiresAt"),
  visibility: mysqlEnum("visibility", ["public", "private", "password"]).default("public"),
  password: varchar("password", { length: 255 }),
  requiredRole: mysqlEnum("requiredRole", ["user", "admin"]),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CmsPage = typeof cmsPages.$inferSelect;
export type InsertCmsPage = typeof cmsPages.$inferInsert;

/**
 * Media library table for tracking uploaded images.
 * Stores metadata for all images uploaded through the system.
 */
export const media = mysqlTable("media", {
  id: int("id").autoincrement().primaryKey(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  fileKey: varchar("fileKey", { length: 500 }).notNull().unique(),
  url: varchar("url", { length: 1000 }).notNull(),
  mimeType: varchar("mimeType", { length: 100 }).notNull(),
  fileSize: int("fileSize").notNull(), // Size in bytes
  width: int("width"), // Image width in pixels
  height: int("height"), // Image height in pixels
  uploadedBy: int("uploadedBy").notNull().references(() => users.id),
  altText: varchar("altText", { length: 255 }),
  caption: text("caption"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Media = typeof media.$inferSelect;
export type InsertMedia = typeof media.$inferInsert;

/**
 * Media tags table for categorizing images.
 */
export const mediaTags = mysqlTable("media_tags", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 50 }).notNull().unique(),
  slug: varchar("slug", { length: 50 }).notNull().unique(),
  color: varchar("color", { length: 7 }), // Hex color code for UI display
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type MediaTag = typeof mediaTags.$inferSelect;
export type InsertMediaTag = typeof mediaTags.$inferInsert;

/**
 * Junction table for media-tag relationships (many-to-many).
 */
export const mediaImageTags = mysqlTable("media_image_tags", {
  mediaId: int("mediaId").notNull().references(() => media.id, { onDelete: "cascade" }),
  tagId: int("tagId").notNull().references(() => mediaTags.id, { onDelete: "cascade" }),
}, (table) => ({
  pk: primaryKey({ columns: [table.mediaId, table.tagId] }),
}));

/**
 * Media collections table for organizing images into albums/groups.
 */
export const mediaCollections = mysqlTable("media_collections", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  createdBy: int("createdBy").notNull().references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MediaCollection = typeof mediaCollections.$inferSelect;
export type InsertMediaCollection = typeof mediaCollections.$inferInsert;

/**
 * Junction table for collection-media relationships (many-to-many).
 */
export const collectionImages = mysqlTable("collection_images", {
  collectionId: int("collectionId").notNull().references(() => mediaCollections.id, { onDelete: "cascade" }),
  mediaId: int("mediaId").notNull().references(() => media.id, { onDelete: "cascade" }),
  addedAt: timestamp("addedAt").defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.collectionId, table.mediaId] }),
}));

/**
 * WordPress import history table for tracking import sessions.
 */
export const importHistory = mysqlTable("import_history", {
  id: int("id").autoincrement().primaryKey(),
  sourceUrl: varchar("sourceUrl", { length: 500 }).notNull(),
  importedBy: int("importedBy").notNull().references(() => users.id),
  status: mysqlEnum("status", ["in_progress", "completed", "failed"]).default("in_progress").notNull(),
  totalPosts: int("totalPosts").default(0),
  importedPosts: int("importedPosts").default(0),
  skippedPosts: int("skippedPosts").default(0),
  failedPosts: int("failedPosts").default(0),
  errorMessage: text("errorMessage"),
  transformationRules: json("transformationRules"), // Store find-replace rules as JSON
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type ImportHistory = typeof importHistory.$inferSelect;
export type InsertImportHistory = typeof importHistory.$inferInsert;

/**
 * Blog comments table for user engagement.
 * Supports moderation workflow with approval/rejection.
 */
export const blogComments = mysqlTable("blog_comments", {
  id: int("id").autoincrement().primaryKey(),
  postId: int("postId").notNull().references(() => blogPosts.id, { onDelete: "cascade" }),
  authorName: varchar("authorName", { length: 100 }).notNull(),
  authorEmail: varchar("authorEmail", { length: 320 }).notNull(),
  content: text("content").notNull(),
  status: mysqlEnum("status", ["pending", "approved", "rejected", "spam"]).default("pending").notNull(),
  ipAddress: varchar("ipAddress", { length: 45 }), // IPv4 or IPv6
  userAgent: text("userAgent"),
  parentId: int("parentId"), // For nested replies
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BlogComment = typeof blogComments.$inferSelect;
export type InsertBlogComment = typeof blogComments.$inferInsert;

/**
 * Email subscribers table for newsletter functionality.
 * Tracks subscription status and preferences.
 */
export const emailSubscribers = mysqlTable("email_subscribers", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  name: varchar("name", { length: 100 }),
  status: mysqlEnum("status", ["active", "unsubscribed"]).default("active").notNull(),
  subscribeSource: varchar("subscribeSource", { length: 100 }), // e.g., "homepage", "blog-post", "footer"
  confirmationToken: varchar("confirmationToken", { length: 64 }),
  confirmedAt: timestamp("confirmedAt"),
  unsubscribedAt: timestamp("unsubscribedAt"),
  subscribedAt: timestamp("subscribedAt").defaultNow().notNull(),
  lastEmailSentAt: timestamp("lastEmailSentAt"),
  // Notification preferences
  digestFrequency: mysqlEnum("digestFrequency", ["daily", "weekly", "monthly", "never"]).default("weekly").notNull(),
  contentTypes: varchar("contentTypes", { length: 255 }).default("blog,news,updates").notNull(), // Comma-separated list
  lastDigestSentAt: timestamp("lastDigestSentAt"),
});

export type EmailSubscriber = typeof emailSubscribers.$inferSelect;
export type InsertEmailSubscriber = typeof emailSubscribers.$inferInsert;

/**
 * Notifications table for in-app user notifications.
 * Supports various notification types with read/unread status.
 */
export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: mysqlEnum("type", ["comment", "approval", "mention", "system"]).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  link: varchar("link", { length: 500 }), // URL to navigate when clicked
  isRead: int("isRead").default(0).notNull(), // 0 = unread, 1 = read
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

/**
 * Custom Post Types table - defines custom content types beyond blog posts and pages.
 * Examples: portfolios, testimonials, products, events, team members, etc.
 */
export const customPostTypes = mysqlTable("custom_post_types", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(), // e.g., "Portfolio", "Testimonial"
  slug: varchar("slug", { length: 100 }).notNull().unique(), // e.g., "portfolio", "testimonial"
  singularName: varchar("singularName", { length: 100 }).notNull(), // e.g., "Portfolio Item"
  pluralName: varchar("pluralName", { length: 100 }).notNull(), // e.g., "Portfolio Items"
  description: text("description"),
  icon: varchar("icon", { length: 50 }), // Lucide icon name
  isPublic: int("isPublic").default(1).notNull(), // 1 = public, 0 = private
  hasArchive: int("hasArchive").default(1).notNull(), // 1 = has archive page, 0 = no archive
  hierarchical: int("hierarchical").default(0).notNull(), // 1 = supports parent/child, 0 = flat
  supportsTitle: int("supportsTitle").default(1).notNull(),
  supportsContent: int("supportsContent").default(1).notNull(),
  supportsExcerpt: int("supportsExcerpt").default(1).notNull(),
  supportsFeaturedImage: int("supportsFeaturedImage").default(1).notNull(),
  supportsCategories: int("supportsCategories").default(0).notNull(),
  supportsTags: int("supportsTags").default(0).notNull(),
  supportsComments: int("supportsComments").default(0).notNull(),
  menuPosition: int("menuPosition").default(20), // Position in admin menu
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CustomPostType = typeof customPostTypes.$inferSelect;
export type InsertCustomPostType = typeof customPostTypes.$inferInsert;

/**
 * Custom Post Items table - stores actual content for custom post types.
 * This is a flexible table that works with any custom post type.
 */
export const customPostItems = mysqlTable("custom_post_items", {
  id: int("id").autoincrement().primaryKey(),
  postTypeId: int("postTypeId").notNull().references(() => customPostTypes.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull(),
  excerpt: text("excerpt"),
  content: text("content"),
  featuredImage: varchar("featuredImage", { length: 500 }),
  authorId: int("authorId").notNull().references(() => users.id),
  parentId: int("parentId"), // For hierarchical post types
  status: mysqlEnum("status", ["draft", "published", "scheduled", "archived"]).default("draft").notNull(),
  publishedAt: timestamp("publishedAt"),
  scheduledPublishAt: timestamp("scheduledPublishAt"),
  menuOrder: int("menuOrder").default(0), // For manual ordering
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CustomPostItem = typeof customPostItems.$inferSelect;
export type InsertCustomPostItem = typeof customPostItems.$inferInsert;

/**
 * Menus table for navigation menu management.
 * Supports multiple menus (header, footer, sidebar, etc.)
 */
export const menus = mysqlTable("menus", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  description: text("description"),
  location: varchar("location", { length: 50 }), // e.g., "header", "footer", "sidebar"
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Menu = typeof menus.$inferSelect;
export type InsertMenu = typeof menus.$inferInsert;

/**
 * Menu items table for individual menu entries.
 * Supports hierarchical structure with parent/child relationships.
 */
export const menuItems = mysqlTable("menu_items", {
  id: int("id").autoincrement().primaryKey(),
  menuId: int("menuId").notNull().references(() => menus.id, { onDelete: "cascade" }),
  parentId: int("parentId"), // Self-reference for hierarchical menus
  label: varchar("label", { length: 100 }).notNull(),
  type: mysqlEnum("type", ["custom", "page", "post", "category", "tag", "post-type"]).notNull(),
  url: varchar("url", { length: 500 }), // For custom links
  targetId: int("targetId"), // ID of referenced content (page, post, etc.)
  targetType: varchar("targetType", { length: 50 }), // Type of referenced content
  cssClasses: varchar("cssClasses", { length: 255 }), // Custom CSS classes
  target: varchar("target", { length: 20 }).default("_self"), // _self, _blank, etc.
  menuOrder: int("menuOrder").default(0), // For ordering items
  isVisible: int("isVisible").default(1).notNull(), // 1 = visible, 0 = hidden
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MenuItem = typeof menuItems.$inferSelect;
export type InsertMenuItem = typeof menuItems.$inferInsert;

/**
 * Custom Fields table for defining flexible metadata fields.
 * Can be attached to any content type (posts, pages, custom post types).
 */
export const customFields = mysqlTable("custom_fields", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull(),
  type: mysqlEnum("type", ["text", "textarea", "number", "select", "checkbox", "date", "file", "url", "email"]).notNull(),
  description: text("description"),
  defaultValue: text("defaultValue"),
  options: text("options"), // JSON array for select fields
  isRequired: int("isRequired").default(0).notNull(),
  contentType: varchar("contentType", { length: 50 }).notNull(), // "blog", "page", "custom-post-type-slug"
  displayOrder: int("displayOrder").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CustomField = typeof customFields.$inferSelect;
export type InsertCustomField = typeof customFields.$inferInsert;

/**
 * Custom Field Values table for storing actual field data.
 * Links content items to their custom field values.
 */
export const customFieldValues = mysqlTable("custom_field_values", {
  id: int("id").autoincrement().primaryKey(),
  fieldId: int("fieldId").notNull().references(() => customFields.id, { onDelete: "cascade" }),
  contentId: int("contentId").notNull(), // ID of the content item (blog post, page, etc.)
  contentType: varchar("contentType", { length: 50 }).notNull(), // "blog", "page", etc.
  value: text("value").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CustomFieldValue = typeof customFieldValues.$inferSelect;
export type InsertCustomFieldValue = typeof customFieldValues.$inferInsert;

/**
 * Blog Series table for grouping related posts into ordered collections.
 * Allows creating multi-part content with automatic navigation.
 */
export const blogSeries = mysqlTable("blog_series", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  description: text("description"),
  coverImage: varchar("coverImage", { length: 1000 }),
  status: mysqlEnum("status", ["draft", "published"]).default("draft").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BlogSeries = typeof blogSeries.$inferSelect;
export type InsertBlogSeries = typeof blogSeries.$inferInsert;

/**
 * Blog Series Posts junction table.
 * Links posts to series with ordering information.
 */
export const blogSeriesPosts = mysqlTable("blog_series_posts", {
  id: int("id").autoincrement().primaryKey(),
  seriesId: int("seriesId").notNull().references(() => blogSeries.id, { onDelete: "cascade" }),
  postId: int("postId").notNull().references(() => blogPosts.id, { onDelete: "cascade" }),
  orderIndex: int("orderIndex").notNull(), // Position in series (1, 2, 3, etc.)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type BlogSeriesPost = typeof blogSeriesPosts.$inferSelect;
export type InsertBlogSeriesPost = typeof blogSeriesPosts.$inferInsert;

// TODO: Add your tables here
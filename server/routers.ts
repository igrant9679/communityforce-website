import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, publicProcedure, protectedProcedure, router, editorProcedure, authorProcedure, contributorProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import axios from "axios";
import { ENV } from "./_core/env";
import * as db from "./db";
import { emailSubscribers } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { storagePut } from "./storage";
import { randomBytes } from 'crypto';
import { optimizeImage } from './imageOptimization';
import * as wpImport from './wordpressImport';
import { checkForSpam } from './spamFilter';
import { notifyOwner } from './_core/notification';
import { generateWeeklyDigest } from './emailDigest';
import { getPageAnalytics } from './analytics';
import { generateOGImage } from './ogImageGenerator';
import { userManagementRouter } from './userManagement';
import { auditLogRouter } from './auditLogRouter';
import { customPostTypesRouter } from './routers/customPostTypesRouter';
import { menuRouter } from './routers/menuRouter';
import { customFieldsRouter } from './routers/customFieldsRouter';
import { authorRouter } from './routers/authorRouter';

import { logAudit } from './auditLog';
import { ONE_YEAR_MS } from "@shared/const";
import { sdk } from "./_core/sdk";
import {
  clearFailures,
  getUserByUsername,
  hashPassword,
  isThrottled,
  recordFailure,
  verifyPassword,
} from "./localAuth";
import { users as usersTable } from "../drizzle/schema";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    login: publicProcedure
      .input(z.object({
        username: z.string().min(1).max(64),
        password: z.string().min(1).max(200),
      }))
      .mutation(async ({ input, ctx }) => {
        const username = input.username.trim().toLowerCase();

        if (isThrottled(username)) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "Too many failed attempts. Try again in 15 minutes.",
          });
        }

        const user = await getUserByUsername(username);
        const valid = user?.passwordHash
          ? await verifyPassword(input.password, user.passwordHash)
          : false;

        if (!user || !valid) {
          recordFailure(username);
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid username or password",
          });
        }

        clearFailures(username);
        await db.upsertUser({ openId: user.openId, lastSignedIn: new Date() });

        const sessionToken = await sdk.signSession(
          {
            openId: user.openId,
            appId: ENV.appId || "local",
            name: user.name || user.username || "user",
          },
          { expiresInMs: ONE_YEAR_MS }
        );
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

        return { success: true, role: user.role } as const;
      }),
    changePassword: protectedProcedure
      .input(z.object({
        currentPassword: z.string().min(1).max(200),
        newPassword: z.string().min(8).max(200),
      }))
      .mutation(async ({ input, ctx }) => {
        if (!ctx.user.passwordHash) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This account does not use password login",
          });
        }
        const valid = await verifyPassword(input.currentPassword, ctx.user.passwordHash);
        if (!valid) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Current password is incorrect" });
        }
        const database = await db.getDb();
        if (!database) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        }
        await database
          .update(usersTable)
          .set({ passwordHash: await hashPassword(input.newPassword) })
          .where(eq(usersTable.id, ctx.user.id));
        return { success: true } as const;
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  blog: router({    list: publicProcedure.query(async () => {
      return db.getPublishedBlogPosts();
    }),

    getBySlug: publicProcedure
      .input(z.object({ slug: z.string() }))
      .query(async ({ input, ctx }) => {
        // Admins can view unpublished posts
        const includeUnpublished = ctx.user?.role === 'admin';
        return db.getBlogPostBySlug(input.slug, includeUnpublished);
      }),

    search: publicProcedure
      .input(z.object({
        query: z.string().optional(),
        categoryId: z.number().optional(),
        tagId: z.number().optional(),
        authorId: z.number().optional(),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
        page: z.number().default(1),
        limit: z.number().default(10),
      }))
      .query(async ({ input }) => {
        return db.searchBlogPosts(input);
      }),

    getRelated: publicProcedure
      .input(z.object({ 
        postId: z.number(),
        limit: z.number().default(3),
      }))
      .query(async ({ input }) => {
        const { getRelatedPosts } = await import('./relatedPosts');
        return getRelatedPosts(input.postId, input.limit);
      }),

    // Admin-only procedures
    listAll: adminProcedure.query(async () => {
      return db.getAllBlogPosts();
    }),

    getById: adminProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return db.getBlogPostById(input.id);
      }),

    create: authorProcedure
      .input(z.object({
        title: z.string().min(1),
        slug: z.string().min(1),
        excerpt: z.string().optional(),
        content: z.string().min(1),
        coverImage: z.string().optional(),
        status: z.enum(["draft", "published", "scheduled", "archived"]).default("draft"),
        scheduledPublishAt: z.date().optional().nullable(),
        tags: z.string().optional(),
        metaDescription: z.string().optional(),
        readTimeMinutes: z.number().optional(),
        metaTitle: z.string().optional(),
        ogTitle: z.string().optional(),
        ogDescription: z.string().optional(),
        ogImage: z.string().optional(),
        generateOGImage: z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Check publish permission if trying to publish
        if (input.status === 'published' && !['admin', 'editor', 'author'].includes(ctx.user.role)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You don't have permission to publish posts" });
        }
        
        const authorId = ctx.user.id;
        const publishedAt = input.status === "published" ? new Date() : undefined;
        
        let ogImage = input.ogImage;
        
        // Generate OG image if requested and no custom image provided
        if (input.generateOGImage && !ogImage) {
          try {
            const result = await generateOGImage({
              title: input.title,
              subtitle: input.excerpt,
              type: 'blog',
            });
            if (result) {
              ogImage = result.url;
            }
          } catch (error) {
            console.error('Failed to generate OG image:', error);
          }
        }
        
        const postId = await db.createBlogPost({
          ...input,
          authorId,
          publishedAt,
          ogImage,
        });
        
        await logAudit({
          userId: ctx.user.id,
          action: 'blog:create',
          entityType: 'blog_post',
          entityId: postId,
          details: { title: input.title, status: input.status },
        });
        
        return postId;
      }),

    update: contributorProcedure
      .input(z.object({
        id: z.number(),
        title: z.string().min(1).optional(),
        slug: z.string().min(1).optional(),
        excerpt: z.string().optional(),
        content: z.string().min(1).optional(),
        coverImage: z.string().optional(),
        status: z.enum(["draft", "published", "scheduled", "archived"]).optional(),
        scheduledPublishAt: z.date().optional().nullable(),
        tags: z.string().optional(),
        metaDescription: z.string().optional(),
        readTimeMinutes: z.number().optional(),
        metaTitle: z.string().optional(),
        ogTitle: z.string().optional(),
        ogDescription: z.string().optional(),
        ogImage: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...updates } = input;
        
        // Get current post to check ownership and permissions
        const currentPost = await db.getBlogPostById(id);
        if (!currentPost) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Post not found" });
        }
        
        // Check if user can edit this post
        const isOwner = currentPost.authorId === ctx.user.id;
        const canEditAny = ['admin', 'editor'].includes(ctx.user.role);
        
        if (!isOwner && !canEditAny) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You can only edit your own posts" });
        }
        
        // Check publish permission if trying to publish
        if (updates.status === 'published' && !['admin', 'editor', 'author'].includes(ctx.user.role)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You don't have permission to publish posts" });
        }
        const wasPublished = currentPost?.status === 'published';
        const isNowPublished = updates.status === 'published';
        
        await db.updateBlogPost(id, updates);
        
        // If post was just published, notify admins (respecting preferences)
        if (!wasPublished && isNowPublished) {
          try {
            const adminUsers = await db.getAdminUsers();
            for (const admin of adminUsers) {
              // Don't notify the author
              if (admin.id !== ctx.user.id) {
                const prefs = await db.getUserNotificationPreferences(admin.id);
                if (prefs && prefs.notifyApprovals) {
                  await db.createNotification({
                    userId: admin.id,
                    type: "approval",
                    title: "Blog Post Published",
                    message: `${ctx.user.name || 'A user'} published "${currentPost?.title || 'a blog post'}"`,
                    link: `/blog/${currentPost?.slug}`,
                    isRead: 0,
                  });
                }
              }
            }
          } catch (error) {
            console.error("[Blog] Failed to send notification:", error);
          }
        }
        
        await logAudit({
          userId: ctx.user.id,
          action: 'blog:update',
          entityType: 'blog_post',
          entityId: id,
          details: { updates },
        });
        
        return { success: true };
      }),

    delete: contributorProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        // Get post to check ownership
        const post = await db.getBlogPostById(input.id);
        if (!post) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Post not found" });
        }
        
        // Check if user can delete this post
        const isOwner = post.authorId === ctx.user.id;
        const canDeleteAny = ['admin', 'editor'].includes(ctx.user.role);
        
        if (!isOwner && !canDeleteAny) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You can only delete your own posts" });
        }
        
        await logAudit({
          userId: ctx.user.id,
          action: 'blog:delete',
          entityType: 'blog_post',
          entityId: input.id,
        });
        
        return db.deleteBlogPost(input.id);
      }),

    bulkUpdateStatus: adminProcedure
      .input(z.object({
        postIds: z.array(z.number()),
        status: z.enum(["draft", "published", "archived"]),
      }))
      .mutation(async ({ input }) => {
        return db.bulkUpdatePostStatus(input.postIds, input.status);
      }),

    bulkAssignCategories: adminProcedure
      .input(z.object({
        postIds: z.array(z.number()),
        categoryIds: z.array(z.number()),
      }))
      .mutation(async ({ input }) => {
        return db.bulkAssignCategories(input.postIds, input.categoryIds);
      }),

    bulkAssignTags: adminProcedure
      .input(z.object({
        postIds: z.array(z.number()),
        tagIds: z.array(z.number()),
      }))
      .mutation(async ({ input }) => {
        return db.bulkAssignTags(input.postIds, input.tagIds);
      }),

    bulkDelete: adminProcedure
      .input(z.object({ postIds: z.array(z.number()) }))
      .mutation(async ({ input }) => {
        return db.bulkDeletePosts(input.postIds);
      }),

    exportAll: adminProcedure
      .input(z.object({ format: z.enum(["json", "xml"]) }))
      .query(async ({ input }) => {
        const posts = await db.getAllBlogPosts();
        
        if (input.format === "json") {
          return {
            format: "json" as const,
            data: JSON.stringify(posts, null, 2),
            filename: `blog-export-${Date.now()}.json`,
          };
        } else {
          // Generate XML
          let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<blog>\n';
          for (const post of posts) {
            xml += '  <post>\n';
            xml += `    <id>${post.id}</id>\n`;
            xml += `    <title><![CDATA[${post.title}]]></title>\n`;
            xml += `    <slug>${post.slug}</slug>\n`;
            xml += `    <content><![CDATA[${post.content}]]></content>\n`;
            xml += `    <excerpt><![CDATA[${post.excerpt || ''}]]></excerpt>\n`;
            xml += `    <status>${post.status}</status>\n`;
            xml += `    <coverImage>${post.coverImage || ''}</coverImage>\n`;
            xml += `    <publishedAt>${post.publishedAt || ''}</publishedAt>\n`;
            xml += `    <createdAt>${post.createdAt}</createdAt>\n`;
            xml += '  </post>\n';
          }
          xml += '</blog>';
          
          return {
            format: "xml" as const,
            data: xml,
            filename: `blog-export-${Date.now()}.xml`,
          };
        }
      }),

    // Category and tag archive pages
    getByCategory: publicProcedure
      .input(z.object({
        categorySlug: z.string(),
        page: z.number().default(1),
        pageSize: z.number().default(10),
      }))
      .query(async ({ input }) => {
        const { getPostsByCategory, getSubcategories } = await import('./blogArchives');
        const result = await getPostsByCategory(input.categorySlug, input.page, input.pageSize);
        
        if (!result.category) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Category not found' });
        }
        
        const subcategories = await getSubcategories(result.category.id);
        
        return {
          ...result,
          subcategories,
          totalPages: Math.ceil(result.total / input.pageSize),
        };
      }),

    getByTag: publicProcedure
      .input(z.object({
        tagSlug: z.string(),
        page: z.number().default(1),
        pageSize: z.number().default(10),
      }))
      .query(async ({ input }) => {
        const { getPostsByTag } = await import('./blogArchives');
        const result = await getPostsByTag(input.tagSlug, input.page, input.pageSize);
        
        if (!result.tag) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Tag not found' });
        }
        
        return {
          ...result,
          totalPages: Math.ceil(result.total / input.pageSize),
        };
      }),
  }),

  blogSeries: router({
    // Public procedures
    list: publicProcedure.query(async () => {
      return db.getPublishedBlogSeries();
    }),

    getBySlug: publicProcedure
      .input(z.object({ slug: z.string() }))
      .query(async ({ input }) => {
        const series = await db.getBlogSeriesBySlug(input.slug);
        if (!series) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Series not found' });
        }
        const posts = await db.getSeriesPosts(series.id);
        return { series, posts };
      }),

    // Admin procedures
    listAll: adminProcedure.query(async () => {
      return db.getSeriesWithPostCount();
    }),

    getById: adminProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const series = await db.getBlogSeriesById(input.id);
        if (!series) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Series not found' });
        }
        const posts = await db.getSeriesPosts(input.id);
        return { series, posts };
      }),

    create: adminProcedure
      .input(z.object({
        title: z.string().min(1),
        slug: z.string().min(1),
        description: z.string().optional(),
        coverImage: z.string().optional(),
        status: z.enum(["draft", "published"]).default("draft"),
      }))
      .mutation(async ({ input }) => {
        return db.createBlogSeries(input);
      }),

    update: adminProcedure
      .input(z.object({
        id: z.number(),
        title: z.string().min(1).optional(),
        slug: z.string().min(1).optional(),
        description: z.string().optional(),
        coverImage: z.string().optional(),
        status: z.enum(["draft", "published"]).optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...updates } = input;
        return db.updateBlogSeries(id, updates);
      }),

    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return db.deleteBlogSeries(input.id);
      }),

    addPost: adminProcedure
      .input(z.object({
        seriesId: z.number(),
        postId: z.number(),
        orderIndex: z.number(),
      }))
      .mutation(async ({ input }) => {
        return db.addPostToSeries(input.seriesId, input.postId, input.orderIndex);
      }),

    removePost: adminProcedure
      .input(z.object({
        seriesId: z.number(),
        postId: z.number(),
      }))
      .mutation(async ({ input }) => {
        return db.removePostFromSeries(input.seriesId, input.postId);
      }),

    updatePostOrder: adminProcedure
      .input(z.object({
        seriesId: z.number(),
        postId: z.number(),
        newOrderIndex: z.number(),
      }))
      .mutation(async ({ input }) => {
        return db.updatePostOrderInSeries(input.seriesId, input.postId, input.newOrderIndex);
      }),

    getPostSeries: publicProcedure
      .input(z.object({ postId: z.number() }))
      .query(async ({ input }) => {
        return db.getPostSeries(input.postId);
      }),

    getNavigation: publicProcedure
      .input(z.object({
        seriesId: z.number(),
        currentOrderIndex: z.number(),
      }))
      .query(async ({ input }) => {
        return db.getSeriesNavigation(input.seriesId, input.currentOrderIndex);
      }),
  }),

  blogCategory: router({
    list: publicProcedure.query(async () => {
      return db.getAllBlogCategories();
    }),

    listFlat: publicProcedure.query(async () => {
      return db.getAllBlogCategoriesFlat();
    }),

    create: adminProcedure
      .input(z.object({
        name: z.string().min(1),
        slug: z.string().min(1),
        description: z.string().optional(),
        parentId: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        return db.createBlogCategory(input);
      }),

    update: adminProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        slug: z.string().min(1).optional(),
        description: z.string().optional(),
        parentId: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...updates } = input;
        return db.updateBlogCategory(id, updates);
      }),

    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return db.deleteBlogCategory(input.id);
      }),
  }),

  blogTag: router({
    list: publicProcedure.query(async () => {
      return db.getAllBlogTags();
    }),

    create: adminProcedure
      .input(z.object({
        name: z.string().min(1),
        slug: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        return db.createBlogTag(input);
      }),

    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return db.deleteBlogTag(input.id);
      }),

    assignToPost: adminProcedure
      .input(z.object({
        postId: z.number(),
        categoryIds: z.array(z.number()),
        tagIds: z.array(z.number()),
      }))
      .mutation(async ({ input }) => {
        await db.assignCategoriesToPost(input.postId, input.categoryIds);
        await db.assignTagsToPost(input.postId, input.tagIds);
        return { success: true };
      }),

    getForPost: publicProcedure
      .input(z.object({ postId: z.number() }))
      .query(async ({ input }) => {
        const [categories, tags] = await Promise.all([
          db.getCategoriesForPost(input.postId),
          db.getTagsForPost(input.postId),
        ]);
        return { categories, tags };
      }),
  }),

  contact: router({
    submitDemo: publicProcedure
      .input(z.object({
        name: z.string().min(1),
        email: z.string().email(),
        organization: z.string().min(1),
        phone: z.string().optional(),
        message: z.string().optional()
      }))
      .mutation(async ({ input }) => {
        try {
          // Send email notification to sales@rapidapplications.com
          const emailContent = `
New Demo Request

Name: ${input.name}
Email: ${input.email}
Organization: ${input.organization}
Phone: ${input.phone || 'Not provided'}

Message:
${input.message || 'No message provided'}

---
Submitted from RapidApplications Website
          `;

          // Use Manus notification API to send email
          await axios.post(
            `${ENV.forgeApiUrl}/v1/notification/send`,
            {
              to: "sales@rapidapplications.com",
              subject: `Demo Request from ${input.name} (${input.organization})`,
              content: emailContent
            },
            {
              headers: {
                Authorization: `Bearer ${ENV.forgeApiKey}`,
                "Content-Type": "application/json"
              }
            }
          );

          return { success: true };
        } catch (error) {
          console.error("Failed to send demo request email:", error);
          throw new Error("Failed to submit demo request");
        }
      }),
    
    submitExpert: publicProcedure
      .input(z.object({
        name: z.string().min(1),
        email: z.string().email(),
        organization: z.string().min(1),
        phone: z.string().optional(),
        message: z.string().min(1)
      }))
      .mutation(async ({ input }) => {
        try {
          // Send email notification to sales@rapidapplications.com
          const emailContent = `
New Expert Consultation Request

Name: ${input.name}
Email: ${input.email}
Organization: ${input.organization}
Phone: ${input.phone || 'Not provided'}

Message:
${input.message}

---
Submitted from RapidApplications Website
          `;

          // Use Manus notification API to send email
          await axios.post(
            `${ENV.forgeApiUrl}/v1/notification/send`,
            {
              to: "sales@rapidapplications.com",
              subject: `Expert Consultation Request from ${input.name} (${input.organization})`,
              content: emailContent
            },
            {
              headers: {
                Authorization: `Bearer ${ENV.forgeApiKey}`,
                "Content-Type": "application/json"
              }
            }
          );

          return { success: true };
        } catch (error) {
          console.error("Failed to send expert request email:", error);
          throw new Error("Failed to submit expert request");
        }
      })
  }),

  /**
   * CMS Pages Router
   */
  cms: router({
    // List all CMS pages (editor and above)
    list: editorProcedure
      .query(async () => {
        return await db.getAllCmsPages();
      }),

    // Get CMS page by slug (public)
    getBySlug: publicProcedure
      .input(z.object({ slug: z.string(), password: z.string().optional() }))
      .query(async ({ input, ctx }) => {
        const page = await db.getCmsPageBySlug(input.slug);
        if (!page) throw new TRPCError({ code: 'NOT_FOUND', message: 'Page not found' });
        
        // Admins bypass all access control
        const isAdmin = ctx.user?.role === 'admin';
        
        if (!isAdmin) {
          // Check visibility for non-admins
          if (page.visibility === 'private') {
            // Private pages require authentication
            if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Login required' });
            
            // Check role requirement
            if (page.requiredRole && ctx.user.role !== page.requiredRole) {
              throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
            }
          } else if (page.visibility === 'password') {
            // Password-protected pages
            if (!input.password || input.password !== page.password) {
              throw new TRPCError({ code: 'FORBIDDEN', message: 'Invalid password' });
            }
          }
          
          // Non-admins need published status
          if (page.status !== 'published') {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Page not found' });
          }
        }
        
        return page;
      }),

    // Get CMS page by ID (editor and above)
    getById: editorProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return await db.getCmsPageById(input.id);
      }),

    // Create CMS page (editor and above)
    create: editorProcedure
      .input(z.object({
        title: z.string().min(1),
        slug: z.string().min(1),
        content: z.string(),
        metaDescription: z.string().optional(),
        status: z.enum(['draft', 'published', 'scheduled', 'archived']).default('draft'),
        scheduledPublishAt: z.date().optional(),
        template: z.string().optional()
      }))
      .mutation(async ({ input, ctx }) => {
        const page = await db.createCmsPage({
          ...input,
          authorId: ctx.user.id
        });
        return { success: true, id: page.id, slug: page.slug };
      }),

    // Update CMS page (editor and above)
    update: editorProcedure
      .input(z.object({
        id: z.number(),
        title: z.string().min(1).optional(),
        slug: z.string().min(1).optional(),
        content: z.string().optional(),
        metaDescription: z.string().optional(),
        status: z.enum(['draft', 'published', 'scheduled', 'archived']).optional(),
        scheduledPublishAt: z.date().optional(),
        visibility: z.enum(['public', 'private', 'password']).optional(),
        password: z.string().optional(),
        requiredRole: z.enum(['user', 'admin']).optional()
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...updates } = input;
        // Create version snapshot before updating
        await db.createPageVersion(id, ctx.user.id);
        await db.updateCmsPage(id, updates);
        return { success: true };
      }),

    // Delete CMS page (editor and above)
    delete: editorProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return await db.deleteCmsPage(input.id);
      }),

    // Bulk update CMS pages (editor and above)
    bulkUpdate: editorProcedure
      .input(z.object({ ids: z.array(z.number()), status: z.enum(['draft', 'published', 'archived']) }))
      .mutation(async ({ input }) => {
        // Bulk update page status
        await Promise.all(input.ids.map(id => db.updateCmsPage(id, { status: input.status })));
        return { success: true, count: input.ids.length };
      }),

    // Duplicate CMS page (editor and above)
    duplicate: editorProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const page = await db.getCmsPageById(input.id);
        if (!page) throw new TRPCError({ code: 'NOT_FOUND', message: 'Page not found' });
        
        // Generate unique slug
        let newSlug = `${page.slug}-copy`;
        let counter = 1;
        while (await db.getCmsPageBySlug(newSlug)) {
          newSlug = `${page.slug}-copy-${counter}`;
          counter++;
        }
        
        await db.createCmsPage({
          title: `${page.title} (Copy)`,
          slug: newSlug,
          content: page.content,
          metaDescription: page.metaDescription || undefined,
          metaKeywords: page.metaKeywords || undefined,
          status: 'draft',
          template: page.template || undefined,
          authorId: ctx.user.id
        });
        
        return { success: true, slug: newSlug };
      }),

    // Reorder CMS pages (admin only)
    reorder: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN' });
        return next({ ctx });
      })
      .input(z.object({
        pageOrders: z.array(z.object({
          id: z.number(),
          displayOrder: z.number()
        }))
      }))
      .mutation(async ({ input }) => {
        for (const { id, displayOrder } of input.pageOrders) {
          await db.updateCmsPage(id, { displayOrder });
        }
        return { success: true };
      }),

    // Get page version history (admin only)
    versions: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN' });
        return next({ ctx });
      })
      .input(z.object({ pageId: z.number() }))
      .query(async ({ input }) => {
        return db.getPageVersions(input.pageId);
      }),

    // Restore page from version (admin only)
    restore: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN' });
        return next({ ctx });
      })
      .input(z.object({ 
        pageId: z.number(),
        versionId: z.number()
      }))
      .mutation(async ({ input, ctx }) => {
        await db.restorePageFromVersion(input.pageId, input.versionId, ctx.user.id);
        return { success: true };
      }),

    // Generate preview token (admin only)
    generatePreviewToken: protectedProcedure
      .use(({ ctx, next }) => {
        if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN' });
        return next({ ctx });
      })
      .input(z.object({ pageId: z.number() }))
      .mutation(async ({ input }) => {
        const { nanoid } = await import('nanoid');
        const token = nanoid(32);
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
        
        await db.updateCmsPage(input.pageId, {
          previewToken: token,
          previewExpiresAt: expiresAt,
        });
        
        return { token, expiresAt };
      }),

    // Get page by preview token (public)
    getByPreviewToken: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const page = await db.getCmsPageByPreviewToken(input.token);
        if (!page) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invalid or expired preview link' });
        return page;
      })
  }),

  /**
   * Media Upload Router
   */
  media: router({
    // Upload image to S3 and save metadata (contributor and above)
    uploadImage: contributorProcedure
      .input(z.object({
        filename: z.string(),
        contentType: z.string(),
        base64Data: z.string(),
        width: z.number().optional(),
        height: z.number().optional(),
        altText: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        try {
          // Generate unique filename with random suffix
          const ext = input.filename.split('.').pop();
          const randomSuffix = randomBytes(8).toString('hex');
          const safeFilename = input.filename
            .replace(/[^a-z0-9.-]/gi, '-')
            .toLowerCase();
          const fileKey = `uploads/${ctx.user.id}/${Date.now()}-${randomSuffix}-${safeFilename}`;

          // Convert base64 to buffer
          const buffer = Buffer.from(input.base64Data, 'base64');

          // Optimize image (compress and convert to WebP)
          const optimized = await optimizeImage(buffer, {
            quality: 85,
            maxWidth: 2048,
            maxHeight: 2048,
            format: 'webp',
          });

          // Update filename extension to .webp
          const webpFileKey = fileKey.replace(/\.[^.]+$/, '.webp');

          // Upload optimized image to S3
          const result = await storagePut(webpFileKey, optimized.buffer, optimized.mimeType);

          // Save metadata to database
          await db.createMedia({
            fileName: input.filename.replace(/\.[^.]+$/, '.webp'),
            fileKey: result.key,
            url: result.url,
            mimeType: optimized.mimeType,
            fileSize: optimized.size,
            width: optimized.width,
            height: optimized.height,
            uploadedBy: ctx.user.id,
            altText: input.altText,
          });

          return {
            success: true,
            url: result.url,
            key: result.key
          };
        } catch (error) {
          console.error('Image upload error:', error);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to upload image'
          });
        }
      }),

    // List all media (contributor and above)
    list: contributorProcedure
      .input(z.object({
        search: z.string().optional(),
      }).optional())
      .query(async ({ input }) => {
        return db.getAllMedia(input?.search);
      }),

    // Get media by ID
    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return db.getMediaById(input.id);
      }),

    // Update media metadata (contributor and above, with ownership check)
    update: contributorProcedure
      .input(z.object({
        id: z.number(),
        altText: z.string().optional(),
        caption: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...updates } = input;
        
        // Get media to check ownership
        const media = await db.getMediaById(id);
        if (!media) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Media not found" });
        }
        
        // Check if user can edit this media
        const isOwner = media.uploadedBy === ctx.user.id;
        const canEditAny = ['admin', 'editor'].includes(ctx.user.role);
        
        if (!isOwner && !canEditAny) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You can only edit your own media" });
        }
        
        return db.updateMedia(id, updates);
      }),

    // Delete media (contributor and above, with ownership check)
    delete: contributorProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        // Get media to check ownership
        const media = await db.getMediaById(input.id);
        if (!media) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Media not found" });
        }
        
        // Check if user can delete this media
        const isOwner = media.uploadedBy === ctx.user.id;
        const canDeleteAny = ['admin', 'editor'].includes(ctx.user.role);
        
        if (!isOwner && !canDeleteAny) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You can only delete your own media" });
        }
        
        // TODO: Also delete from S3 if needed
        return db.deleteMedia(input.id);
      }),

    // Bulk delete media (editor and above)
    bulkDelete: editorProcedure
      .input(z.object({ ids: z.array(z.number()) }))
      .mutation(async ({ input }) => {
        // TODO: Also delete from S3 if needed
        return db.bulkDeleteMedia(input.ids);
      }),

    // Get tags for media
    getTags: protectedProcedure
      .input(z.object({ mediaId: z.number() }))
      .query(async ({ input }) => {
        return db.getTagsForMedia(input.mediaId);
      }),

    // Assign tag to media (admin only)
    assignTag: adminProcedure
      .input(z.object({
        mediaId: z.number(),
        tagId: z.number(),
      }))
      .mutation(async ({ input }) => {
        return db.assignTagToMedia(input.mediaId, input.tagId);
      }),

    // Unassign tag from media (admin only)
    unassignTag: adminProcedure
      .input(z.object({
        mediaId: z.number(),
        tagId: z.number(),
      }))
      .mutation(async ({ input }) => {
        return db.unassignTagFromMedia(input.mediaId, input.tagId);
      }),

    // Update media metadata (admin only)
    updateMetadata: adminProcedure
      .input(z.object({
        id: z.number(),
        altText: z.string().optional(),
        caption: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...updates } = input;
        return db.updateMedia(id, updates);
      }),

    // Get image usage (where it's referenced)
    getUsage: protectedProcedure
      .input(z.object({ url: z.string() }))
      .query(async ({ input }) => {
        return db.getImageUsage(input.url);
      }),
  }),

  /**
   * Media Collections Router
   */
  mediaCollection: router({
    // List all collections
    list: protectedProcedure.query(async () => {
      return db.getAllCollections();
    }),

    // Create collection (admin only)
    create: adminProcedure
      .input(z.object({
        name: z.string().min(1),
        description: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        return db.createCollection({
          ...input,
          createdBy: ctx.user.id,
        });
      }),

    // Delete collection (admin only)
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return db.deleteCollection(input.id);
      }),

    // Get media by collection
    getMedia: protectedProcedure
      .input(z.object({ collectionId: z.number() }))
      .query(async ({ input }) => {
        return db.getMediaByCollectionId(input.collectionId);
      }),

    // Get collections for media
    getForMedia: protectedProcedure
      .input(z.object({ mediaId: z.number() }))
      .query(async ({ input }) => {
        return db.getCollectionsForMedia(input.mediaId);
      }),

    // Assign media to collection (admin only)
    assignMedia: adminProcedure
      .input(z.object({
        collectionId: z.number(),
        mediaId: z.number(),
      }))
      .mutation(async ({ input }) => {
        return db.assignMediaToCollection(input.collectionId, input.mediaId);
      }),

    // Remove media from collection (admin only)
    removeMedia: adminProcedure
      .input(z.object({
        collectionId: z.number(),
        mediaId: z.number(),
      }))
      .mutation(async ({ input }) => {
        return db.removeMediaFromCollection(input.collectionId, input.mediaId);
      }),
  }),

  /**
   * Media Tags Router
   */
  mediaTag: router({
    // List all media tags
    list: publicProcedure.query(async () => {
      return db.getAllMediaTags();
    }),

    // Create media tag (admin only)
    create: adminProcedure
      .input(z.object({
        name: z.string().min(1),
        slug: z.string().min(1),
        color: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        return db.createMediaTag(input);
      }),

    // Delete media tag (admin only)
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return db.deleteMediaTag(input.id);
      }),

    // Get media by tag
    getMediaByTag: publicProcedure
      .input(z.object({ tagId: z.number() }))
      .query(async ({ input }) => {
        return db.getMediaByTagId(input.tagId);
      }),
  }),

  /**
   * WordPress Import Router
   */
  wordpressImport: router({
    // Fetch posts from WordPress site
    fetchPosts: adminProcedure
      .input(z.object({
        siteUrl: z.string().url(),
        page: z.number().default(1),
        perPage: z.number().default(10),
      }))
      .query(async ({ input }) => {
        return wpImport.fetchWordPressPosts(input.siteUrl, input.page, input.perPage);
      }),

    // Fetch categories from WordPress
    fetchCategories: adminProcedure
      .input(z.object({ siteUrl: z.string().url() }))
      .query(async ({ input }) => {
        return wpImport.fetchWordPressCategories(input.siteUrl);
      }),

    // Fetch tags from WordPress
    fetchTags: adminProcedure
      .input(z.object({ siteUrl: z.string().url() }))
      .query(async ({ input }) => {
        return wpImport.fetchWordPressTags(input.siteUrl);
      }),

    // Import single post
    importPost: adminProcedure
      .input(z.object({
        siteUrl: z.string().url(),
        wpPost: z.any(), // WordPress post object
        categoryMap: z.record(z.string(), z.number()), // WP category ID -> local category ID
        tagMap: z.record(z.string(), z.number()), // WP tag ID -> local tag ID
        transformationRules: z.array(z.object({ find: z.string(), replace: z.string() })).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { wpPost, categoryMap, tagMap, transformationRules } = input;

        // Check if post already exists by slug
        const existing = await db.getBlogPostBySlug(wpPost.slug);
        if (existing) {
          return { success: false, message: 'Post already exists', slug: wpPost.slug };
        }

        // Download and optimize featured image if exists
        let coverImage = null;
        if (wpPost._embedded?.['wp:featuredmedia']?.[0]?.source_url) {
          const imageUrl = wpPost._embedded['wp:featuredmedia'][0].source_url;
          const altText = wpPost._embedded['wp:featuredmedia'][0].alt_text || '';
          const imageResult = await wpImport.downloadAndOptimizeImage(imageUrl, altText, ctx.user.id);
          
          if (imageResult) {
            // Save to media library
            const mediaId = await db.createMedia({
              fileName: imageUrl.split('/').pop() || 'imported-image.webp',
              fileKey: imageResult.key,
              url: imageResult.url,
              mimeType: 'image/webp',
              fileSize: imageResult.size,
              width: imageResult.width,
              height: imageResult.height,
              uploadedBy: ctx.user.id,
              altText,
            });
            coverImage = imageResult.url;
          }
        }

        // Clean content with transformation rules
        const content = wpImport.cleanWordPressContent(wpPost.content.rendered, transformationRules);
        const excerpt = wpImport.cleanWordPressContent(wpPost.excerpt.rendered, transformationRules);

        // Create blog post
        const postId = await db.createBlogPost({
          title: wpPost.title.rendered,
          slug: wpPost.slug,
          excerpt: excerpt || null,
          content,
          coverImage,
          authorId: ctx.user.id,
          status: wpPost.status === 'publish' ? 'published' : 'draft',
          publishedAt: wpPost.status === 'publish' ? new Date(wpPost.date) : null,
        });

        // Assign categories
        const categoryIds = wpPost.categories
          .map((wpCatId: number) => categoryMap[wpCatId.toString()])
          .filter((id: number | undefined) => id !== undefined);
        if (categoryIds.length > 0) {
          await db.assignCategoriesToPost(postId, categoryIds);
        }

        // Assign tags
        const tagIds = wpPost.tags
          .map((wpTagId: number) => tagMap[wpTagId.toString()])
          .filter((id: number | undefined) => id !== undefined);
        if (tagIds.length > 0) {
          await db.assignTagsToPost(postId, tagIds);
        }

        return { success: true, postId, slug: wpPost.slug };
      }),
  }),

  importHistory: router({
    list: adminProcedure.query(async () => {
      return db.getAllImportHistory();
    }),

    getById: adminProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return db.getImportHistoryById(input.id);
      }),

    create: adminProcedure
      .input(z.object({
        sourceUrl: z.string(),
        transformationRules: z.any().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        return db.createImportHistory({
          sourceUrl: input.sourceUrl,
          importedBy: ctx.user.id,
          transformationRules: input.transformationRules,
        });
      }),

    update: adminProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["in_progress", "completed", "failed"]).optional(),
        totalPosts: z.number().optional(),
        importedPosts: z.number().optional(),
        skippedPosts: z.number().optional(),
        failedPosts: z.number().optional(),
        errorMessage: z.string().optional(),
        completedAt: z.date().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...updates } = input;
        return db.updateImportHistory(id, updates);
      }),
  }),

  analytics: router({
    getPageStats: publicProcedure
      .input(z.object({ pageId: z.number(), pageType: z.enum(["blog", "cms"]) }))
      .query(async ({ input }) => {
        return await getPageAnalytics(input.pageId, input.pageType);
      }),

    // Content analytics procedures (admin only)
    getTopPosts: adminProcedure
      .input(z.object({ limit: z.number().optional(), days: z.number().optional() }))
      .query(async ({ input }) => {
        const { getTopPostsByViews } = await import("./analytics");
        return getTopPostsByViews(input.limit, input.days);
      }),

    getEngagementMetrics: adminProcedure
      .input(z.object({ postId: z.number().optional() }))
      .query(async ({ input }) => {
        const { getPostEngagementMetrics } = await import("./analytics");
        return getPostEngagementMetrics(input.postId);
      }),

    getAuthorStats: adminProcedure
      .query(async () => {
        const { getAuthorPerformanceStats } = await import("./analytics");
        return getAuthorPerformanceStats();
      }),

    getTrafficSources: adminProcedure
      .input(z.object({ days: z.number().optional() }))
      .query(async ({ input }) => {
        const { getTrafficSources } = await import("./analytics");
        return getTrafficSources(input.days);
      }),

    getViewTrends: adminProcedure
      .input(z.object({ days: z.number().optional() }))
      .query(async ({ input }) => {
        const { getViewTrends } = await import("./analytics");
        return getViewTrends(input.days);
      }),

    getOverallStats: adminProcedure
      .query(async () => {
        const { getOverallContentStats } = await import("./analytics");
        return getOverallContentStats();
      }),

    getRecentPopular: adminProcedure
      .input(z.object({ limit: z.number().optional() }))
      .query(async ({ input }) => {
        const { getRecentPopularPosts } = await import("./analytics");
        return getRecentPopularPosts(input.limit);
      }),
  }),

  subscriber: router({
    // Public procedures
    subscribe: publicProcedure
      .input(z.object({
        email: z.string().email().max(320),
        name: z.string().min(1).max(100).optional(),
        subscribeSource: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        // Check if email already exists
        const existing = await db.getSubscriberByEmail(input.email);
        
        if (existing) {
          if (existing.status === "unsubscribed") {
            // Reactivate subscription
            await db.unsubscribeEmail(input.email); // This will update status
            // Then update to active
            const dbInstance = await db.getDb();
            if (dbInstance) {
              await dbInstance
                .update(emailSubscribers)
                .set({ 
                  status: "active",
                  subscribedAt: new Date(),
                  unsubscribedAt: null,
                })
                .where(eq(emailSubscribers.email, input.email));
            }
            return { success: true, message: "Subscription reactivated!" };
          }
          return { success: false, message: "Email already subscribed" };
        }

        // Create new subscriber
        await db.createSubscriber(input);
        
        // Send welcome email notification to owner
        try {
          await notifyOwner({
            title: "New Newsletter Subscriber",
            content: `New subscriber: ${input.name || 'Anonymous'} (${input.email})\nSource: ${input.subscribeSource || 'Unknown'}`,
          });
        } catch (error) {
          console.error("[Subscriber] Failed to send notification:", error);
        }

        return { success: true, message: "Successfully subscribed!" };
      }),

    unsubscribe: publicProcedure
      .input(z.object({ email: z.string().email() }))
      .mutation(async ({ input }) => {
        const existing = await db.getSubscriberByEmail(input.email);
        if (!existing) {
          return { success: false, message: "Email not found" };
        }
        
        await db.unsubscribeEmail(input.email);
        return { success: true, message: "Successfully unsubscribed" };
      }),

    // Get preferences
    getPreferences: publicProcedure
      .input(z.object({ email: z.string().email() }))
      .query(async ({ input }) => {
        return db.getSubscriberPreferences(input.email);
      }),

    // Update preferences
    updatePreferences: publicProcedure
      .input(z.object({
        email: z.string().email(),
        digestFrequency: z.enum(["daily", "weekly", "monthly", "never"]).optional(),
        contentTypes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { email, ...preferences } = input;
        await db.updateSubscriberPreferences(email, preferences);
        return { success: true, message: "Preferences updated successfully" };
      }),

    // Admin procedures
    listAll: adminProcedure.query(async () => {
      return db.getAllSubscribers();
    }),

    listActive: adminProcedure.query(async () => {
      return db.getActiveSubscribers();
    }),

    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return db.deleteSubscriber(input.id);
      }),

    generateDigest: adminProcedure
      .mutation(async () => {
        return generateWeeklyDigest();
      }),
  }),

  comment: router({
    // Public procedures
    listByPost: publicProcedure
      .input(z.object({ postId: z.number() }))
      .query(async ({ input }) => {
        return db.getCommentsByPostId(input.postId, false);
      }),

    create: publicProcedure
      .input(z.object({
        postId: z.number(),
        authorName: z.string().min(1).max(100),
        authorEmail: z.string().email().max(320),
        content: z.string().min(1).max(5000),
        parentId: z.number().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Get IP address and user agent from request
        const ipAddress = ctx.req.ip || ctx.req.headers['x-forwarded-for'] as string || undefined;
        const userAgent = ctx.req.headers['user-agent'] || undefined;

        // Check for spam
        const spamCheck = checkForSpam({
          authorName: input.authorName,
          authorEmail: input.authorEmail,
          content: input.content,
          ipAddress,
        });

        // Get post details for notification
        const post = await db.getBlogPostById(input.postId);

        // Create comment with automatic spam detection
        const comment = await db.createComment({
          ...input,
          ipAddress,
          userAgent,
        });

        // If spam detected, automatically mark as spam
        if (spamCheck.isSpam) {
          await db.updateCommentStatus(comment.id, "spam");
          console.log(`[Comment] Automatically marked as spam (score: ${spamCheck.score}): ${spamCheck.reason}`);
        } else {
          // Send notification to owner about new comment pending moderation
          try {
            await notifyOwner({
              title: "New Comment Pending Moderation",
              content: `A new comment from ${input.authorName} (${input.authorEmail}) is awaiting moderation on "${post?.title || 'Unknown Post'}".\n\nComment: ${input.content.substring(0, 200)}${input.content.length > 200 ? '...' : ''}\n\nReview at: /admin/comments`,
            });
            
            // Create in-app notification for all admin users (respecting preferences)
            const adminUsers = await db.getAdminUsers();
            for (const admin of adminUsers) {
              const prefs = await db.getUserNotificationPreferences(admin.id);
              if (prefs && prefs.notifyComments) {
                await db.createNotification({
                  userId: admin.id,
                  type: "comment",
                  title: "New Comment",
                  message: `${input.authorName} commented on "${post?.title || 'Unknown Post'}"`,
                  link: `/admin/comments`,
                  isRead: 0,
                });
              }
            }
            
            // If this is a reply, notify the parent comment author
            if (input.parentId) {
              const parentComment = await db.getCommentById(input.parentId);
              if (parentComment && parentComment.authorEmail !== input.authorEmail) {
                // Send email notification to parent comment author
                await notifyOwner({
                  title: "Someone Replied to Your Comment",
                  content: `${input.authorName} replied to your comment on "${post?.title || 'Unknown Post'}":\n\n"${input.content.substring(0, 200)}${input.content.length > 200 ? '...' : ''}"\n\nYour original comment: "${parentComment.content.substring(0, 100)}..."\n\nView at: /blog/${post?.slug}#comment-${comment.id}\n\nTo stop receiving reply notifications, click here: [unsubscribe link]`,
                });
              }
            }
          } catch (error) {
            console.error("[Comment] Failed to send notification:", error);
            // Don't fail the comment creation if notification fails
          }
        }

        return comment;
      }),

    getCount: publicProcedure
      .input(z.object({ postId: z.number() }))
      .query(async ({ input }) => {
        return db.getCommentCount(input.postId);
      }),

    // Admin procedures
    listAll: adminProcedure.query(async () => {
      return db.getAllComments();
    }),

    listPending: adminProcedure.query(async () => {
      return db.getPendingComments();
    }),

    updateStatus: adminProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["approved", "rejected", "spam"]),
      }))
      .mutation(async ({ input }) => {
        // Update comment status
        const result = await db.updateCommentStatus(input.id, input.status);

        // Send notification to owner when comment is approved
        if (input.status === "approved") {
          try {
            // Get comment details
            const allComments = await db.getAllComments();
            const comment = allComments.find(c => c.id === input.id);
            
            if (comment) {
              await notifyOwner({
                title: "Comment Approved",
                content: `You approved a comment from ${comment.authorName} on "${comment.postTitle}".\n\nComment: ${comment.content.substring(0, 200)}${comment.content.length > 200 ? '...' : ''}\n\nView post: /blog/${comment.postSlug}`,
              });
            }
          } catch (error) {
            console.error("[Comment] Failed to send approval notification:", error);
            // Don't fail the status update if notification fails
          }
        }

        return result;
      }),

    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        return db.deleteComment(input.id);
      }),
  }),

  notifications: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return db.getNotifications(ctx.user.id);
    }),

    getUnreadCount: protectedProcedure.query(async ({ ctx }) => {
      return db.getUnreadCount(ctx.user.id);
    }),

    markRead: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.markNotificationRead(input.id);
        return { success: true };
      }),

    markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
      await db.markAllNotificationsRead(ctx.user.id);
      return { success: true };
    }),

    // Get user notification preferences
    getPreferences: protectedProcedure.query(async ({ ctx }) => {
      return db.getUserNotificationPreferences(ctx.user.id);
    }),

    // Update user notification preferences
    updatePreferences: protectedProcedure
      .input(z.object({
        notifyComments: z.boolean().optional(),
        notifyApprovals: z.boolean().optional(),
        notifyMentions: z.boolean().optional(),
        notifySystem: z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        return db.updateNotificationPreferences(ctx.user.id, input);
      }),
  }),

  userManagement: userManagementRouter,
  auditLog: auditLogRouter,
  customPostTypes: customPostTypesRouter,
  menu: menuRouter,
  customFields: customFieldsRouter,
  author: authorRouter,
});

export type AppRouter = typeof appRouter;

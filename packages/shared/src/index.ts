import { z } from "zod";

export * from "./protocol";
export * from "./office-map";
export * from "./realtime-ticket";

export const OfficeRoleSchema = z.enum([
  "owner",
  "admin",
  "member",
  "freelancer",
]);
export type OfficeRole = z.infer<typeof OfficeRoleSchema>;

export const InvitationRoleSchema = z.enum(["admin", "member", "freelancer"]);
export type InvitationRole = z.infer<typeof InvitationRoleSchema>;

export const InvitationCreateInputSchema = z.object({
  officeId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email().max(254),
  role: InvitationRoleSchema,
  expiresInHours: z.number().int().min(1).max(168).default(24),
});
export type InvitationCreateInput = z.infer<typeof InvitationCreateInputSchema>;

export const InviteTokenSchema = z
  .string()
  .min(43)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u, "Invitation token must be base64url encoded");

export const InvitationAcceptInputSchema = z.object({
  token: InviteTokenSchema,
  displayName: z.string().trim().min(1).max(40),
});
export type InvitationAcceptInput = z.infer<typeof InvitationAcceptInputSchema>;

export const AccessLinkCreateInputSchema = z.object({
  officeId: z.string().uuid(),
  memberLabel: z.string().trim().min(1).max(40),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  role: InvitationRoleSchema,
});
export type AccessLinkCreateInput = z.infer<typeof AccessLinkCreateInputSchema>;

export const AccessLinkRedeemInputSchema = z.object({
  token: InviteTokenSchema,
  displayName: z.string().trim().min(1).max(40),
});
export type AccessLinkRedeemInput = z.infer<typeof AccessLinkRedeemInputSchema>;

export const AccessLinkRevokeInputSchema = z.object({
  officeId: z.string().uuid(),
  linkId: z.string().uuid(),
});
export type AccessLinkRevokeInput = z.infer<typeof AccessLinkRevokeInputSchema>;

export const UsernameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{2,20}$/u, "Username must be 2-20 letters or digits");

export const UserCreateInputSchema = z.object({
  officeId: z.string().uuid(),
  username: UsernameSchema,
  password: z.string().min(8).max(72),
  role: InvitationRoleSchema.default("member"),
});
export type UserCreateInput = z.infer<typeof UserCreateInputSchema>;

export const AppEnvironmentSchema = z.enum([
  "development",
  "staging",
  "production",
]);
export type AppEnvironment = z.infer<typeof AppEnvironmentSchema>;

export interface ActiveMembership {
  officeId: string;
  officeSlug: string;
  officeName: string;
  role: OfficeRole;
}

import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Source map upload only happens when SENTRY_AUTH_TOKEN is set (CI/Vercel).
  silent: !process.env.CI,
  widenClientFileUpload: true,
});

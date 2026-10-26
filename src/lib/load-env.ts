/**
 * Loads env files for scripts and tools that run outside Next.js
 * (Next.js loads these files itself). `.env.local` wins over `.env`.
 */
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

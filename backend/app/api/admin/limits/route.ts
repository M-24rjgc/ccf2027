import { env } from "cloudflare:workers";
import { handleAdmin } from "@/lib/usage.mjs";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => handleAdmin(request, env);

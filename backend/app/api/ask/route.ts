import { env } from "cloudflare:workers";
import { handle } from "@/lib/service.mjs";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => handle(request, env);
export const OPTIONS = POST;

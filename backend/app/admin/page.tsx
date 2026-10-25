import { env } from "cloudflare:workers";
import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from "../chatgpt-auth";
import { authorizeAdmin } from "@/lib/usage.mjs";
import UsagePanel from "./usage-panel";
import "./admin.css";

export const dynamic = "force-dynamic";
export const metadata = {title:"用量管理 · CCF 会议助手",robots:{index:false,follow:false}};

export default async function AdminPage() {
  const user = await getChatGPTUser();
  let allowed = false, message = "使用网站所有者的 ChatGPT 账号登录，查看用量并设置上限。";
  if (user) {
    try { await authorizeAdmin(user,env); allowed=true; }
    catch (e) { message=e instanceof Error?e.message:"管理服务暂时不可用"; }
  }
  return <main className="usage-app">
    <header className="usage-header"><div><a href="https://m-24rjgc.github.io/ccf2027/">← 返回会议助手</a><h1>用量管理</h1><p>共享问答服务的每日用量与额度</p></div>
      {user && <a className="usage-secondary" href={chatGPTSignOutPath("/admin")} target="_top">退出管理账号</a>}</header>
    {allowed ? <UsagePanel/> : <section className="usage-login"><h2>{user?"暂时无法进入":"管理员登录"}</h2><p>{message}</p>
      {!user && <a className="usage-primary" href={chatGPTSignInPath("/admin")} target="_top">使用 ChatGPT 登录</a>}
      {user && <a className="usage-secondary" href="/admin">重新检查</a>}</section>}
  </main>;
}

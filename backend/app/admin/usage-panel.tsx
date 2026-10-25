"use client";
import { useEffect, useState } from "react";

const FIELDS = [
  ["dailyQuestions","每日提问总数",100000], ["dailyTokens","每日 token 总额度",1000000000],
  ["dailySearch","每日搜索次数",1000000], ["dailyFetch","每日网页抓取次数",1000000],
  ["dailyWeb","每日搜索与抓取合计",1000000], ["perClientDaily","每个网络来源每日提问数",10000],
  ["dailyModels","每日模型调用数",1000000], ["perMinute","每个网络来源每分钟提问数",60], ["concurrency","最多同时回答数",20],
] as const;
type Config = Record<string, number>;
type Day = {day:number;questions:number;completed:number;failed:number;search_calls:number;fetch_calls:number;model_calls:number;prompt_tokens:number;completion_tokens:number;total_tokens:number;unreported_calls:number;unreported_tokens:number;legacy_questions:number;legacy_web:number;legacy_tokens:number};
type Report = {today:number;resetsAt:number;startedAt:number;limits:Config;version:number;days:Day[];used:Record<string,number>};
const n = (value:number|undefined) => (value||0).toLocaleString("zh-CN");
const date = (day:number) => new Date(day*86400000).toISOString().slice(0,10);

export default function UsagePanel() {
  const [report,setReport]=useState<Report|null>(null), [draft,setDraft]=useState<Record<string,string>>({});
  const [days,setDays]=useState(30), [loading,setLoading]=useState(false), [saving,setSaving]=useState(false);
  const [error,setError]=useState(""), [saved,setSaved]=useState("");
  async function refresh(replaceDraft=true) {
    setLoading(true); setError("");
    try {
      const r=await fetch(`/api/admin/usage?days=${days}`,{credentials:"same-origin",cache:"no-store"});
      const data=await r.json() as Report & {error?:string}; if(!r.ok)throw new Error(data.error||"读取用量失败");
      setReport(previous => !replaceDraft && previous ? {...data,limits:previous.limits,version:previous.version} : data);
      if(replaceDraft)setDraft(Object.fromEntries(FIELDS.map(([key])=>[key,String(data.limits[key])])));
    } catch(e) { setError(e instanceof Error?e.message:"暂时无法连接服务"); }
    finally {setLoading(false);}
  }
  useEffect(()=>{ void refresh(report===null); },[days]);
  async function save(e:React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); if(!report)return; setSaving(true);setError("");setSaved("");
    try {
      const values=Object.fromEntries(FIELDS.map(([key])=>[key,Number(draft[key])]));
      const r=await fetch("/api/admin/limits",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({limits:values,version:report.version})});
      const data=await r.json() as {limits:Config;version:number;error?:string};if(!r.ok)throw new Error(data.error||"保存失败");
      setReport({...report,limits:{...report.limits,...data.limits},version:data.version});
      setSaved("已保存。新的提问和后续模型、联网调用立即按新上限执行。");
    } catch(e) {setError(e instanceof Error?e.message:"保存失败，请稍后重试");}
    finally {setSaving(false);}
  }
  const today=report?.days.find(d=>d.day===report.today);
  const dirty=report && FIELDS.some(([key])=>draft[key]!==String(report.limits[key]));
  return <>
    <div className="usage-toolbar"><p>每日按 UTC 归档 · 北京时间每天 <b>08:00</b> 重置额度</p><button type="button" className="usage-secondary" disabled={loading||saving} onClick={()=>void refresh(!dirty)}>{loading?"正在刷新…":"刷新用量"}</button></div>
    {error&&<div className="usage-error" role="alert">{error} <a href="/admin">重新进入管理页</a></div>}
    {saved&&<div className="usage-success" role="status">{saved}</div>}
    {!report ? <div className="usage-login">{loading?"正在读取用量…":"暂未读到用量，可点击刷新重试。"}</div> : <>
      <section aria-label="今日用量" className="usage-cards">
        <article><h2>今日提问</h2><strong>{n(today?.questions)}</strong><p>完成 {n(today?.completed)} · 失败 / 停止 {n(today?.failed)}</p></article>
        <article><h2>联网搜索</h2><strong>{n(today?.search_calls)}</strong><p>网页抓取 {n(today?.fetch_calls)} 次</p></article>
        <article><h2>已确认 token</h2><strong>{n(today?.total_tokens)}</strong><p>输入 {n(today?.prompt_tokens)} · 输出 {n(today?.completion_tokens)}</p></article>
        <article><h2>未结算调用</h2><strong>{n(today?.unreported_calls)}</strong><p>暂占 {n(today?.unreported_tokens)} token 额度</p></article>
      </section>
      <div className="usage-columns">
        <section className="usage-section"><div className="usage-section-title"><h2>每日记录</h2><label>范围 <select value={days} disabled={loading||saving} onChange={e=>{setDays(Number(e.target.value));setSaved("");}}>{[7,30,90].map(v=><option key={v} value={v}>近 {v} 天</option>)}</select></label></div>
          <p className="usage-note">提问按接收时间归档，搜索和抓取按发起的调用计数，包含上游失败。token 来自 Step 返回的用量；一次提问可能调用模型多次。</p>
          <div className="usage-table"><table><caption className="usage-sr">共享服务每日用量，日期为 UTC</caption><thead><tr><th>日期（UTC）</th><th>提问</th><th>搜索</th><th>抓取</th><th>输入 token</th><th>输出 token</th><th>总 token</th><th>未结算</th></tr></thead><tbody>
          {Array.from({length:days},(_,i)=>report.today-i).map(day=>{const row=report.days.find(r=>r.day===day);const observed=day>=Math.floor(report.startedAt/86400000);return <tr key={day}><th>{date(day)}{day===report.today&&<span className="usage-today">今天</span>}</th>{["questions","search_calls","fetch_calls","prompt_tokens","completion_tokens","total_tokens","unreported_calls"].map(k=><td key={k}>{row?n(row[k as keyof Day]):observed?"0":"—"}</td>)}</tr>;})}
          </tbody></table></div>
          <p className="usage-note">未结算包含正在生成，以及未返回 usage 的中断或失败调用。暂占额度不是实际消耗；无法确认的用量不会计入“已确认 token”。</p>
          {report.days.some(d=>d.legacy_questions||d.legacy_web||d.legacy_tokens)?<details className="usage-legacy"><summary>升级前的可恢复计数</summary><p>旧版没有保存精确日报。提问计数可能含限流拒绝；联网未区分搜索和抓取；token 数字是额度占用，不能作为实际消耗。这部分仍计入当日限额。</p><div className="usage-table"><table><thead><tr><th>日期（UTC）</th><th>旧提问计数</th><th>旧联网计数</th><th>旧 token 额度占用</th></tr></thead><tbody>{report.days.filter(d=>d.legacy_questions||d.legacy_web||d.legacy_tokens).map(d=><tr key={d.day}><th>{date(d.day)}</th><td>{n(d.legacy_questions)}</td><td>{n(d.legacy_web)}</td><td>{n(d.legacy_tokens)}</td></tr>)}</tbody></table></div></details>:null}
        </section>
        <section className="usage-section"><h2>用量上限</h2><p className="usage-note">设为 0 可暂停对应调用。下调不会清空已用量；已发出的请求仍可能产生用量。</p>
          <div className="usage-quota"><span>今日已占用额度</span><p>提问 {n(report.used.questions)} / {n(report.limits.dailyQuestions)}</p><p>联网 {n(report.used.web)} / {n(report.limits.dailyWeb)}</p><p>token {n(report.used.tokens)} / {n(report.limits.dailyTokens)}</p></div>
          <form onSubmit={save} className="usage-limits">
            {FIELDS.slice(0,6).map(([key,label,max])=><label key={key}>{label}<input type="number" min="0" max={max} step="1" required value={draft[key]??""} disabled={saving||loading} onChange={e=>{setDraft({...draft,[key]:e.target.value});setSaved("");}}/></label>)}
            <p className="usage-note">搜索与抓取同时受各自上限和合计上限约束。同一网络出口的访客共享单来源额度。</p>
            <details><summary>更多限制</summary>{FIELDS.slice(6).map(([key,label,max])=><label key={key}>{label}<input type="number" min="0" max={max} step="1" required value={draft[key]??""} disabled={saving||loading} onChange={e=>{setDraft({...draft,[key]:e.target.value});setSaved("");}}/></label>)}</details>
            <div className="usage-save"><button className="usage-primary" disabled={!dirty||saving||loading}>{saving?"正在保存…":"保存上限"}</button>{dirty&&<span>有未保存的修改</span>}</div>
          </form>
        </section>
      </div>
      <p className="usage-note">统计仅覆盖网站共享服务，包含管理员自己的提问；访客使用个人 Key 的请求不经过本站，无法统计。日报自 {new Date(report.startedAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}（北京）开始记录，横线表示没有历史记录。</p>
    </>}
  </>;
}

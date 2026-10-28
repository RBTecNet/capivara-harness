import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile, unlink, lstat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

const GENERATED = new Set(['.git', '.capivara-next', 'node_modules', '.venv', 'venv', '__pycache__', 'target', 'dist', 'obj', '.next']);
export const digest = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
export function inside(workspace: string, name: string): string {
  const base = resolve(workspace), path = resolve(base, name), rel = relative(base, path);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error(`Path outside workspace: ${name}`);
  return path;
}
export async function sourceFiles(workspace: string, paths?: readonly string[]): Promise<string[]> {
  const found = new Set<string>();
  const visit = async (path: string): Promise<void> => {
    const info = await lstat(path).catch(() => null);
    if (!info || info.isSymbolicLink()) return;
    if (info.isDirectory()) {
      const entries = await readdir(path, { withFileTypes: true });
      for (const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))) if (!GENERATED.has(entry.name)) await visit(join(path,entry.name));
    } else if (info.isFile()) found.add(relative(resolve(workspace),path));
  };
  if (paths?.length) for (const path of paths) await visit(inside(workspace,path));
  else await visit(resolve(workspace));
  return [...found].sort();
}
export async function inputHash(workspace: string, paths: readonly string[] = [], description = ''): Promise<string> {
  const hash = createHash('sha256').update(description);
  for (const path of await sourceFiles(workspace, paths)) hash.update(path).update(await readFile(join(workspace,path)));
  return hash.digest('hex');
}
export interface SourceSnapshot { files: Map<string, Buffer>; }
export async function snapshot(workspace: string): Promise<SourceSnapshot> {
  const files = new Map<string, Buffer>();
  for (const path of await sourceFiles(workspace)) files.set(path, await readFile(join(workspace,path)));
  return {files};
}
export async function changedSince(workspace: string, before: SourceSnapshot): Promise<string[]> {
  const after = await snapshot(workspace), result = new Set<string>();
  for (const [path,content] of after.files) if (!before.files.get(path)?.equals(content)) result.add(path);
  for (const path of before.files.keys()) if (!after.files.has(path)) result.add(path);
  return [...result];
}
export async function restoreFiles(workspace: string, before: SourceSnapshot, files: readonly string[]): Promise<void> {
  for (const name of files) {
    const target = inside(workspace,name), content = before.files.get(name);
    if (content === undefined) await unlink(target).catch(()=>undefined);
    else { await mkdir(dirname(target),{recursive:true}); await writeFile(target,content); }
  }
}
export async function backup(workspace: string, task: string, before: SourceSnapshot): Promise<void> {
  const folder = join(workspace,'.capivara-next','backups');
  const objects = join(folder,'objects');
  await mkdir(objects,{recursive:true});
  const files:Record<string,string>={};
  for (const [name,content] of before.files) {
    const hash=digest(content);files[name]=hash;
    try{await writeFile(join(objects,hash),content,{flag:'wx'});}
    catch(error){if(!(error instanceof Error&&'code' in error&&error.code==='EEXIST'))throw error;}
  }
  // Immutable blobs preserve user data without copying the whole project on every repair.
  await writeFile(join(folder,`${task.replace(/[^a-zA-Z0-9_-]/g,'_')}-${Date.now()}.json`),JSON.stringify({task,createdAt:new Date().toISOString(),files}));
}
/** Recognizes HTTP implementations, without treating terminal/event methods named listen as servers. */
function hasHttpServer(source: string): boolean {
  const code=source.replace(/^\s*(?:\/\/|#).*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'');
  const escaped=(name:string):string=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const httpModule=/(?:from\s*|require\s*\()\s*['"](?:node:)?(?:http|https|http2)['"]/.test(code);
  if(httpModule&&/\b(?:createServer|createSecureServer)\s*\(/.test(code))return true;
  if(/\b(?:Bun|Deno)\.serve\s*\(/.test(code))return true;
  if(/['"]@hono\/node-server['"]/.test(code)&&/\bserve\s*\(/.test(code))return true;
  const factories=new Set<string>();
  for(const match of code.matchAll(/\bimport\s+([\w$]+)\s+from\s*['"](?:express|fastify|koa)['"]|\b(?:const|let|var)\s+([\w$]+)\s*=\s*require\s*\(\s*['"](?:express|fastify|koa)['"]\s*\)/g))factories.add(match[1]??match[2]??'');
  for(const factory of factories){
    const name=escaped(factory);
    if(new RegExp(`\\b${name}\\s*\\([^;]*?\\)\\s*\\.listen\\s*\\(`).test(code))return true;
    for(const match of code.matchAll(new RegExp(`\\b(?:const|let|var)\\s+([\\w$]+)\\s*=\\s*(?:new\\s+)?${name}\\s*\\(`,'g'))){
      if(new RegExp(`\\b${escaped(match[1]??'')}\\s*\\.listen\\s*\\(`).test(code))return true;
    }
  }
  if(/\buvicorn\.run\s*\(|\b(?:hypercorn|waitress)\.(?:serve|run)\s*\(/.test(code))return true;
  if(/(?:from\s+http\.server\s+import|import\s+http\.server)/.test(code)&&/\b(?:HTTPServer|ThreadingHTTPServer|TCPServer)\s*\(/.test(code))return true;
  if(/(?:from\s+aiohttp\s+import|import\s+aiohttp)/.test(code)&&/\b(?:web\.)?run_app\s*\(/.test(code))return true;
  if(/(?:from\s+flask\s+import|import\s+flask)/.test(code)){
    for(const match of code.matchAll(/\b(\w+)\s*=\s*(?:flask\.)?Flask\s*\(/g))if(new RegExp(`\\b${escaped(match[1]??'')}\\.run\\s*\\(`).test(code))return true;
  }
  if(/['"]net\/http['"]/.test(code)&&/\.ListenAndServe(?:TLS)?\s*\(/.test(code))return true;
  if(/\b(?:axum|warp)::serve\s*\(|\brouille::start_server\s*\(/.test(code))return true;
  if(/\bactix_web\b/.test(code)&&/\bHttpServer::new\s*\(/.test(code))return true;
  if(/\bhyper\b/.test(code)&&/(?:\bServer::bind\s*\(|\.serve_connection\s*\()/.test(code))return true;
  if(/\btiny_http\b/.test(code)&&/\bServer::http\s*\(/.test(code))return true;
  if(/\brocket\b/.test(code)&&/\.launch\s*\(/.test(code))return true;
  return /\bnew\s+(?:System\.Net\.)?HttpListener\s*\(/.test(code);
}

/** Checks actual added source, rather than accepting a model's declaration of its effects. */
export async function introducedServers(workspace: string, before: SourceSnapshot): Promise<string[]> {
  const bad: string[] = [];
  for (const name of await changedSince(workspace,before)) {
    if (!/\.(?:[cm]?[jt]sx?|py|go|rs|cs)$/i.test(name) || /(?:^|\/)(?:tests?|specs?)(?:\/|\.)|\.(?:test|spec)\./i.test(name)) continue;
    const previous = before.files.get(name)?.toString('utf8') ?? '';
    const next = await readFile(join(workspace,name),'utf8').catch(()=>'');
    if (hasHttpServer(next) && !hasHttpServer(previous)) bad.push(name);
  }
  return bad;
}

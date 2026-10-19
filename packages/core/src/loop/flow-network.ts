/** Máscara posicional: ignora exemplos, comentários e literais ao localizar chamadas. */
function codeMask(source: string): string {
  const chars = source.split("");
  const hide = (start: number, end: number): void => {
    for (let i = start; i < end; i += 1) if (chars[i] !== "\n") chars[i] = " ";
  };
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === "'" || char === '"' || char === "`") {
      const start = i;
      for (i += 1; i < source.length; i += 1) {
        if (source[i] === "\\") i += 1;
        else if (source[i] === char) break;
      }
      hide(start, i + 1);
    } else if (source.startsWith("//", i)) {
      const end = source.indexOf("\n", i);
      hide(i, end < 0 ? source.length : end);
      i = end < 0 ? source.length : end;
    } else if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      hide(i, end < 0 ? source.length : end + 2);
      i = end < 0 ? source.length : end + 1;
    } else if (char === "/" && /[=(:,[!&|?;{]\s*$/.test(source.slice(0, i))) {
      const start = i;
      let bracket = false;
      for (i += 1; i < source.length; i += 1) {
        if (source[i] === "\\") i += 1;
        else if (source[i] === "[") bracket = true;
        else if (source[i] === "]") bracket = false;
        else if (source[i] === "/" && !bracket) break;
      }
      hide(start, i + 1);
    }
  }
  return chars.join("");
}

function namedHandler(code: string, name: string): [number, number] | null {
  const escaped = name.replace(/[$]/g, "\\$");
  const declaration = new RegExp(`\\b(?:function\\s+${escaped}\\b|(?:const|let|var)\\s+${escaped}\\s*=)`).exec(code);
  if (!declaration) return null;
  const start = declaration.index;
  const stack: string[] = [];
  for (let i = start; i < code.length; i += 1) {
    const char = code[i] ?? "";
    if ("({[".includes(char)) stack.push(char);
    else if (")}]".includes(char)) {
      stack.pop();
      if (char === "}" && stack.length === 0) return [start, i + 1];
    } else if (char === ";" && stack.length === 0) return [start, i + 1];
  }
  return null;
}

/** Controle de leituras reais é válido; resposta fabricada do produto não é. */
export function invalidFlowNetwork(script: string): boolean {
  const code = codeMask(script);
  for (const call of code.matchAll(/\b\w+\s*\.\s*(route|routeFromHAR)\s*\(/g)) {
    if (call[1] === "routeFromHAR") return true;
    const open = call.index + call[0].length - 1;
    let depth = 1;
    let comma = -1;
    let end = open + 1;
    for (; end < code.length && depth > 0; end += 1) {
      if (code[end] === "(") depth += 1;
      else if (code[end] === ")") depth -= 1;
      else if (code[end] === "," && depth === 1 && comma < 0) comma = end;
    }
    if (comma < 0) continue;
    const raw = script.slice(open + 1, comma).trim();
    const literal = /^(['"`])([^'"`]*?)\1$/.exec(raw)?.[2];
    const host = literal ? /^https?:\/\/(\[[^\]]+\]|[^/:]+)/i.exec(literal)?.[1] : undefined;
    if (host && !host.includes("${") && !/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(host)) continue;
    const handler = code.slice(comma + 1, end - 1);
    const range = /^\s*[\w$]+\s*$/.test(handler) ? namedHandler(code, handler.trim()) : null;
    const body = range ? code.slice(...range) : handler;
    const rawHandler = range ? script.slice(...range) : script.slice(comma + 1, end - 1);
    if (/\.\s*(fulfill|fulfillResponse)\s*\(/.test(body)) return true;
    if (/\.\s*abort\s*\(/.test(body) && !/\.\s*method\s*\(\s*\)\s*(?:={2,3}|!={1,2})\s*['"]GET['"]/.test(rawHandler)) return true;
  }
  return false;
}

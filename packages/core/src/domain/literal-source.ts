interface LiteralToken { value:string; start:number; end:number; structural:boolean; }
interface Match { start:number; end:number; }

function tokens(text:string):LiteralToken[]{
  const markers=[...text.matchAll(/^[\t ]*(?:[-*+•◦‣]|\d+[.)]|\(\d+\))[\t ]+/gm)].map(match=>({start:match.index,end:match.index+match[0].length}));
  // Keep technology/path-like words atomic: Go is not Django, Node is not
  // Node.js, and C is not C++. Other punctuation remains a required token.
  return [...text.matchAll(/\.?[\p{L}\p{N}_][\p{L}\p{N}\p{M}_]*(?:[.:-][\p{L}\p{N}\p{M}_]+)*(?:\+\+|#)?|[^\s]/gu)].map(match=>{
    const start=match.index,end=start+match[0].length;
    return{value:match[0],start,end,structural:markers.some(marker=>start>=marker.start&&end<=marker.end)};
  });
}

function matches(source:LiteralToken[],quote:string):Match[]{
  const required=tokens(quote).filter(token=>!token.structural);
  if(!required.length)return[];
  const found:Match[]=[];
  for(let start=0;start<source.length;start++){
    if(source[start]!.value!==required[0]!.value)continue;
    let positions=new Set([start+1]);
    for(let part=1;part<required.length&&positions.size;part++){
      const next=new Set<number>();
      for(const position of positions)for(let cursor=position;cursor<source.length;cursor++){
        const token=source[cursor]!;
        if(token.value===required[part]!.value)next.add(cursor+1);
        if(!token.structural)break;
      }
      positions=next;
    }
    // The first matched token anchors the span; optional source markup cannot
    // manufacture alternative starts before that anchor.
    for(const end of positions)found.push({start,end});
  }
  return found;
}

/** Resolve one literal source span. Only whitespace, structural list markers,
 * and explicit internal omissions ([...] or …) may differ from the quote.
 * Ambiguous matches and unanchored omissions require metadata repair. */
export function resolveLiteralExcerpt(raw:string,quote:string):string|undefined{
  if(!raw.trim()||!quote.trim())return undefined;
  const parts=quote.split(/\[\s*\.\.\.\s*\]|…/u);
  if(parts.some(part=>!tokens(part).some(token=>!token.structural)))return undefined;
  const source=tokens(raw),sections=parts.map(part=>matches(source,part));
  if(sections.some(section=>!section.length))return undefined;
  let chains=sections[0]!.map(match=>({...match,count:1}));
  for(const section of sections.slice(1)){
    chains=section.flatMap(next=>{
      const previous=chains.filter(chain=>chain.end<=next.start);
      if(!previous.length)return[];
      return[{start:previous[0]!.start,end:next.end,count:Math.min(2,previous.reduce((count,chain)=>count+chain.count,0))}];
    });
  }
  if(chains.reduce((count,chain)=>count+chain.count,0)!==1)return undefined;
  const resolved=chains[0]!;
  return raw.slice(source[resolved.start]!.start,source[resolved.end-1]!.end);
}

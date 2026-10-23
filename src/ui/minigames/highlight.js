// Tiny per-line syntax highlighter (ts/tsx/sol/yaml/css/md/json). Tolerates half-streamed lines.
import { esc } from './common.js';

const JS_KW = 'import|from|export|default|const|let|var|function|async|await|return|if|else|throw|new|try|catch|finally|interface|type|extends|implements|class|static|for|of|in|while|true|false|null|undefined|as|typeof|keyof|never|void|this|super|readonly|public|private';
const SOL_KW = 'pragma|solidity|contract|mapping|address|uint256|public|function|external|payable|require|emit|event|indexed|constant|ether|minutes|returns|memory|storage|if|else|return|true|false';

const RULES = {
  ts: [
    ['com', /\/\/.*/y], ['com', /\/\*.*?(\*\/|$)/y],
    ['str', /'(?:\\.|[^'\\])*'?|"(?:\\.|[^"\\])*"?|`(?:\\.|[^`\\])*`?/y],
    ['kw', new RegExp(`\\b(?:${JS_KW})\\b`, 'y')],
    ['num', /\b\d[\d_.]*\b/y],
    ['tag', /<\/?[A-Za-z][\w.]*|\/?>/y],
    ['fn', /[a-zA-Z_$][\w$]*(?=\s*\()/y],
    ['type', /[A-Z][\w$]*/y],
    ['id', /[a-zA-Z_$][\w$]*/y],
    ['ws', /\s+/y], ['op', /[=<>!+\-*/%&|?:]+/y], ['pun', /./y],
  ],
  sol: [
    ['com', /\/\/.*/y], ['str', /"(?:\\.|[^"\\])*"?/y], ['kw', new RegExp(`\\b(?:${SOL_KW})\\b`, 'y')],
    ['num', /\b\d[\d_.]*\b/y], ['fn', /[a-zA-Z_$][\w$]*(?=\s*\()/y], ['type', /[A-Z][\w$]*/y],
    ['id', /[a-zA-Z_$][\w$]*/y], ['ws', /\s+/y], ['op', /[=<>!+\-*/%&|?:^]+/y], ['pun', /./y],
  ],
  yaml: [
    ['com', /#.*/y], ['key', /^\s*-?\s*[\w.\-]+(?=\s*:)/y], ['str', /"(?:\\.|[^"\\])*"?|'[^']*'?/y],
    ['num', /\b\d[\d.]*\w*\b/y], ['kw', /\b(?:true|false|null)\b/y], ['ws', /\s+/y], ['pun', /[{}\[\],:-]/y], ['id', /[^\s{}\[\],:#]+/y], ['pun', /./y],
  ],
  css: [
    ['com', /\/\*.*?(\*\/|$)/y], ['type', /[.#:@][\w-]+/y], ['key', /[\w-]+(?=\s*:)/y],
    ['str', /'[^']*'?|"[^"]*"?/y], ['num', /#[0-9a-fA-F]{3,8}\b|-?\d[\d.]*(px|%|s|deg|em|rem)?/y],
    ['fn', /[\w-]+(?=\()/y], ['id', /[\w-]+/y], ['ws', /\s+/y], ['pun', /./y],
  ],
  md: [
    ['kw', /^#{1,6} .*/y], ['com', /^>.*/y], ['str', /`[^`]*`?/y], ['type', /\*\*[^*]*\*\*?/y],
    ['num', /^\s*- \[[ x]\]/y], ['ws', /\s+/y], ['id', /[^\s`*]+/y], ['pun', /./y],
  ],
  json: [
    ['key', /"(?:\\.|[^"\\])*"(?=\s*:)/y], ['str', /"(?:\\.|[^"\\])*"?/y], ['num', /-?\d[\d.]*/y],
    ['kw', /\b(?:true|false|null)\b/y], ['ws', /\s+/y], ['pun', /./y],
  ],
};
RULES.tsx = RULES.ts;

export function highlight(line, lang = 'ts') {
  const rules = RULES[lang] || RULES.ts;
  let i = 0, out = '';
  while (i < line.length) {
    let matched = false;
    for (const [cls, re] of rules) {
      if (re.source.startsWith('^') && i !== 0) continue;
      re.lastIndex = i;
      const m = re.exec(line);
      if (m && m[0].length) {
        const t = esc(m[0]);
        out += (cls === 'ws' || cls === 'pun' || cls === 'id') ? t : `<span class="t-${cls}">${t}</span>`;
        i += m[0].length; matched = true; break;
      }
    }
    if (!matched) { out += esc(line[i]); i++; }
  }
  return out || '&#8203;';
}

export const langOf = path => {
  const ext = path.split('.').pop();
  return { ts: 'ts', tsx: 'tsx', js: 'ts', sol: 'sol', yaml: 'yaml', yml: 'yaml', css: 'css', md: 'md', json: 'json' }[ext] || 'ts';
};

export const fileIcon = path => {
  const ext = path.split('.').pop();
  return { ts: ['TS', '#3fa7ff'], tsx: ['⚛', '#61dafb'], sol: ['◆', '#b388ff'], yaml: ['☸', '#ff7a7a'], css: ['#', '#ff3ea5'], md: ['M↓', '#9aa4b2'], json: ['{}', '#ffd23f'] }[ext] || ['•', '#ccc'];
};

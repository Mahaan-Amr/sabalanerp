import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Kept byte-for-byte equivalent to the reviewed pure Linux generator's lexer.
// Quoted token bytes remain exact; only external whitespace/comments disappear.
export function schemaTokens(text){
 const tokens=[];let offset=0;const lex=/\s+|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|[A-Za-z_][A-Za-z_0-9]*|[0-9]+(?:\.[0-9]+)?|[^\s]/gy;
 while(offset<text.length){lex.lastIndex=offset;const match=lex.exec(text);assert.ok(match&&match.index===offset,'SCHEMA_TOKEN_GAP');const token=match[0];
  assert.ok(!(token==='"'||token==='/'&&(text[offset+1]==='*'||text[offset+1]==='/')),'SCHEMA_UNTERMINATED_TOKEN');
  offset=lex.lastIndex;if(!/^\s/.test(token)&&!token.startsWith('//')&&!token.startsWith('/*'))tokens.push(token);
 }return tokens;
}
export const schemaTokenDigest=text=>createHash('sha256').update(JSON.stringify(schemaTokens(text))).digest('hex');

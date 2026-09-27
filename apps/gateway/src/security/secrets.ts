const patterns:[string,RegExp][]=[['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i],['jwt',/\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/],['aws-key',/\bAKIA[0-9A-Z]{16}\b/],['generic-token',/\b(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*["']?[^\s"']{12,}/i]];
const blocked=/^(.env|\.env\..*|.*\.(pem|key|p12|pfx)|id_rsa|credentials\..*|secrets\..*)$/i;
export type SecretFinding={kind:string;path:string;snippet:string};
export function scanSecret(path:string,content:string):SecretFinding[]{if(blocked.test(path))return[{kind:'blocked-file',path,snippet:'file excluded by policy'}];return patterns.filter(([,r])=>r.test(content)).map(([kind])=>({kind,path,snippet:'redacted'}));}
export function sanitizeContext(items:{path:string;content:string}[]):{path:string;content:string;findings:SecretFinding[]}[]{return items.flatMap(i=>scanSecret(i.path,i.content).length?[]:[{...i,findings:[]}]);}

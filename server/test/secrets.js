// Credential-shaped values the sweep tests type into every field. N is the distinctive part of every secret below. Shared by the masking sweeps.
export const N = 'Zq9vLmN3xR'; // the distinctive part of every secret below
export const ZW = '\u200b'; export const FW = (s) => [...s].map((c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).join('');
export const SECRETS = [
  `ghp_${N}AbCdEfGhIjKl`, `sk-live-${N}abcdefghij`, `eyJhbGciOiJub25lIn0.eyJzdWIiOiJ${N}In0.c2lnbmF0dXJl${N}`, `my password is ${N}!`, `pw: ${N}`, `{"password":"${N}"}`, `{"pw":"x${N}"}`,
  `https://user:${N}@host.example/x`, `Authorization: token ${N}0123456789`, `Authorization: Bearer ${N}.abcdef.ghijkl`, `%70assword%3D${N}`, `%2570assword%253D${N}`, `%252570assword%25253D${N}`,
  `pa${ZW}ss${ZW}word=${N}`, `p\u2060ass\u00adword=${N}`, `pass\uFFFDword=${N}`, `pass\u{E0061}word=${N}`, `${FW('password')}${FW('=')}${N}`, `xpassword=${N}`, `my_api_key:${N}`, `AKIA${N.toUpperCase()}ABCDEF`.slice(0, 20),
  `${'-----BEGIN '}PRIVATE KEY-----\n${N}abcdef\n${'-----END '}PRIVATE KEY-----`, `${'x'.repeat(19990)} password=${N}`, `${N}0123456789abcdef0123456789abcdef`, `client_secret=${N}`, `passphrase is ${N} two three`,
];
export const needleOf = (s) => (s.includes(N) ? N : s.slice(0, 24));


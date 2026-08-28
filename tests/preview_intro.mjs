// preview_intro.mjs — offline render of the Intro title card (real sprites)
// Confirms: nebula + planet + house silhouette + big legible title, no grid.
import * as SS from '../client/systems/SpriteSystem.js';
import { px } from '../client/systems/SpriteSystem.js';
import zlib from 'node:zlib';
import fs from 'node:fs';

const W = 960, H = 720;
const NEB = SS.makeNebula();
const fb = Buffer.alloc(W * H * 4);
const put = (x, y, c) => { if (x<0||y<0||x>=W||y>=H) return; const i=(y*W+x)*4; fb[i]=c[0]; fb[i+1]=c[1]; fb[i+2]=c[2]; fb[i+3]=255; };

// nebula fill
for (let y=0;y<H;y++) for (let x=0;x<W;x++){ const c=px(NEB,x%256,y%256); put(x,y,c); }
// planets
function blit(cv,sx,sy,flip){ for(let y=0;y<cv.height;y++)for(let x=0;x<cv.width;x++){const p=px(cv,flip?cv.width-1-x:x,y);if(p[3])put(sx+x,sy+y,p);} }
blit(SS.planetSprite, W-190, H-200, false);
blit(SS.planetSprite, 90, 130, true);
// house silhouette (scaled 2.2x, centered)
const sc=2.2, hw=64, hh=60, hx=Math.round(W/2 - hw*sc/2), hy=Math.round(H/2 - 150 - hh*sc/2);
for (let y=0;y<hh;y++) for (let x=0;x<hw;x++){ const p=px(SS.houseSprite,x,y); if(!p[3])continue;
  for(let sy=0;sy<sc;sy++)for(let sx=0;sx<sc;sx++) put(hx+x*sc+sx, hy+y*sc+sy, p); }
// title (big — mirrors the 44px Press Start 2P; drawn chunky for legibility check)
function bigText(str, x, y, color, scale) {
  const F={'S':['0110','1001','0110','0001','1110'],'P':['1110','1001','1110','1000','1000'],'A':['0110','1001','1111','1001','1001'],'C':['0110','1001','1001','1001','0110'],'E':['1111','1000','1110','1000','1111'],'F':['1111','1000','1110','1000','1000'],'R':['1110','1001','1110','1010','1001'],'M':['10001','11011','10101','10001','10001'],' ':'','I':['010','010','010','010','010']};
  let cx=x;
  for (const ch of str){ const g=F[ch]||['101','010','101']; const gw=Math.max(...g.map(r=>r.length));
    for(let gy=0;gy<5;gy++){ const row=g[gy]||''; for(let gx=0;gx<gw;gx++){ if(row[gx]!=='1')continue;
      for(let sy=0;sy<scale;sy++)for(let sx=0;sx<scale;sx++) put(cx+gx*scale+sx, y+gy*scale+sy, color); } }
    cx+=(gw+2)*scale; }
}
const t='SPACE FARMER'; const tw=t.length*7*7;
bigText(t, W/2-tw/2, H/2-40, [220,255,230], 7); // bright, big
// subtitle + prompt (smaller)
function smallText(str,x,y,color,scale){ const F={'A':['0110','1001','1110','1001','1001'],'S':['0110','1001','0110','0001','1110'],'T':['11111','00100','00100','00100','00100'],'E':['1111','1000','1110','1000','1111'],'R':['1110','1001','1110','1010','1001'],'I':['010','010','010','010','010'],'O':['0110','1001','1001','1001','0110'],'D':['1110','1001','1001','1001','1110'],'B':['1110','1001','1110','1001','1110'],'6':['0110','1000','0110','0001','0110'],'1':['010','110','010','000','111'],'2':['111','001','010','100','111'],'8':['011','011','011','011','011'],'9':['011','101','011','000','011'],'-':['000','000','111','000','000'],'Y':['101','101','010','001','001'],'N':['1001','1101','1011','1001','1001'],'U':['1001','1001','1001','1001','0110'],'P':['1110','1001','1110','1000','1000'],'C':['0110','1001','1001','1001','0110']}; let cx=x; for(const ch of str){const g=F[ch]||['101','010','101'];const gw=Math.max(...g.map(r=>r.length));for(let gy=0;gy<5;gy++){const row=g[gy]||'';for(let gx=0;gx<gw;gx++){if(row[gx]!=='1')continue;for(let sy=0;sy<scale;sy++)for(let sx=0;sx<scale;sx++)put(cx+gx*scale+sx,y+gy*scale+sy,color);}}cx+=(gw+2)*scale;} }
const s2='ASTEROID B-612  YEAR 2987'; smallText(s2, W/2 - s2.length*4.5*2, H/2+18, [57,197,187], 4);
const s3='PRESS SPACE  TAP TO BEGIN'; smallText(s3, W/2 - s3.length*4.5*2, H/2+58, [255,233,160], 4);

// PNG encode
function crc32(b){if(!crc32.t){crc32.t=new Int32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);crc32.t[n]=c;}}let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=crc32.t[(c^b[i])&0xFF]^(c>>>8);return(c^0xFFFFFFFF)>>>0;}
function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(td));return Buffer.concat([l,td,c]);}
const sig=Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);const ih=Buffer.alloc(13);ih.writeUInt32BE(W,0);ih.writeUInt32BE(H,4);ih[8]=8;ih[9]=6;
const raw=Buffer.alloc(H*(1+W*4));for(let y=0;y<H;y++){raw[y*(1+W*4)]=0;fb.copy(raw,y*(1+W*4)+1,y*W*4,(y+1)*W*4);}
fs.writeFileSync('/tmp/intro_title.png',Buffer.concat([sig,chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
console.log('wrote /tmp/intro_title.png');

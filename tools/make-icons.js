const zlib = require('zlib'), fs = require('fs');
const SS = 4; // supersample factor

function crc(buf){let c=~0;for(const b of buf){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^(0xEDB88320&-(c&1));}return ~c>>>0;}
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const t=Buffer.from(type,'ascii');const c=Buffer.alloc(4);c.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([len,t,data,c]);}
function png(w,h,rgba){
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
  const raw=Buffer.alloc((w*4+1)*h);
  for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;rgba.copy(raw,y*(w*4+1)+1,y*w*4,(y+1)*w*4);}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
// rounded-rect signed coverage at point
const inRounded=(x,y,w,h,r)=>{const cx=Math.min(Math.max(x,r),w-r),cy=Math.min(Math.max(y,r),h-r);return (x-cx)**2+(y-cy)**2<=r*r||(x>=r&&x<=w-r)||(y>=r&&y<=h-r)?((x<r||x>w-r)&&(y<r||y>h-r)?(x-cx)**2+(y-cy)**2<=r*r:true):false;};

function render(size){
  const S=size*SS, buf=Buffer.alloc(S*S*4);
  const R=S/2;                             // full-bleed circle, same blue as the chip
  const bcx=S*0.5, bcy=S*0.455, br=S*0.205;   // white speech bubble
  const tail=[[S*0.415,S*0.60],[S*0.575,S*0.60],[S*0.455,S*0.775]];
  const inTri=(x,y,[a,b,c])=>{const d=(p,q)=>(q[0]-p[0])*(y-p[1])-(q[1]-p[1])*(x-p[0]);
    const s1=d(a,b),s2=d(b,c),s3=d(c,a);return (s1>=0&&s2>=0&&s3>=0)||(s1<=0&&s2<=0&&s3<=0);};
  for(let y=0;y<S;y++)for(let x=0;x<S;x++){
    const i=(y*S+x)*4;
    if(Math.hypot(x+0.5-R,y+0.5-R)>R)continue;
    // #0a84ff at the top easing into #007aff, so it reads solid at 16px
    const t=(x/S*0.4+y/S*0.6);
    const r=Math.round(10+(0-10)*t), g=Math.round(132+(122-132)*t), b=255;
    let cr=r,cg=g,cb=b;
    const d=Math.hypot(x+0.5-bcx,y+0.5-bcy);
    if(d<=br||inTri(x+0.5,y+0.5,tail)){cr=255;cg=255;cb=255;}
    buf[i]=cr;buf[i+1]=cg;buf[i+2]=cb;buf[i+3]=255;
  }
  // box-downsample to target size
  const out=Buffer.alloc(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    let r=0,g=0,b=0,a=0;
    for(let dy=0;dy<SS;dy++)for(let dx=0;dx<SS;dx++){
      const i=(((y*SS+dy)*S)+(x*SS+dx))*4, al=buf[i+3]/255;
      r+=buf[i]*al;g+=buf[i+1]*al;b+=buf[i+2]*al;a+=al;
    }
    const n=SS*SS, i=(y*size+x)*4;
    out[i]=a?Math.round(r/a):0;out[i+1]=a?Math.round(g/a):0;out[i+2]=a?Math.round(b/a):0;out[i+3]=Math.round(a/n*255);
  }
  return png(size,size,out);
}
for(const s of [16,32,48,128]) fs.writeFileSync(`icons/${s}.png`, render(s));
console.log('icons written');

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, PaperPlaneTilt, PencilSimple, Trash, X } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { AppID, type CollectionBook, type GalleryImage } from '../types';
import { DB } from '../utils/db';
import {
    buildCollectionForwardPayload,
    formatCollectionKindLabel,
    getCollectionDisplayTitle,
} from '../utils/collectionBooks';
import { getGalleryImageDisplayUrl } from '../utils/generatedImageStorage';

/* ============================================================
   Tokens & CSS
   ============================================================ */

const NOISE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

const CSS = `
:root{
  --ar-bg-deep:#0e0b09;
  --ar-surface:#1c1610;
  --ar-surface-2:#262019;
  --ar-line:rgba(255,236,210,.08);
  --ar-t1:#e9dcc6;
  --ar-t2:#b39e83;
  --ar-t3:#80705c;
  --ar-accent:#c9a36a;
  --ar-rose:#a76770;
  --ar-velvet:#3b2028;
  --ar-wood-hi:#7a5a3e;
  --ar-wood-mid:#4e3927;
  --ar-wood-lo:#2b1f14;
  --ar-font-display:'Cormorant Garamond','Noto Serif SC',Georgia,'Songti SC','STSong','SimSun',serif;
  --ar-font-script:'Dancing Script','Segoe Script','Pinyon Script',cursive;
  --ar-font-ui:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;
}
.ar-root{position:relative;width:100%;height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:radial-gradient(130% 55% at 50% -6%, rgba(201,163,106,.10), transparent 58%),linear-gradient(180deg,#1a1410,#14100c 34%,var(--ar-bg-deep));font-family:var(--ar-font-ui);box-shadow:inset 0 0 0 1px rgba(255,236,210,.05)}
.ar-grain{position:absolute;inset:0;z-index:60;pointer-events:none;background-image:${NOISE};opacity:.05;mix-blend-mode:overlay}
.ar-vig{position:absolute;inset:0;z-index:55;pointer-events:none;background:radial-gradient(135% 95% at 50% 26%, transparent 56%, rgba(0,0,0,.42))}

/* ---------- header ---------- */
.ar-exit{position:absolute;top:calc(env(safe-area-inset-top, 0px) + 20px);left:14px;z-index:70;display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:999px;border:1px solid rgba(201,163,106,.24);background:rgba(12,10,8,.58);color:rgba(222,202,172,.86);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-shadow:0 10px 24px -18px rgba(0,0,0,.85);cursor:pointer;transition:color .2s,border-color .2s,background .2s,transform .12s}
.ar-exit:hover{color:var(--ar-t1);border-color:rgba(201,163,106,.46);background:rgba(22,17,13,.76)}
.ar-exit:active{transform:scale(.94)}
.ar-exit:focus-visible{outline:2px solid var(--ar-accent);outline-offset:2px}
.ar-hd{padding:calc(env(safe-area-inset-top, 0px) + 26px) 22px 16px 58px;border-bottom:1px solid var(--ar-line)}
.ar-hd-title{margin:0;font-family:var(--ar-font-display);font-weight:600;font-size:30px;line-height:1.1;letter-spacing:.05em;color:var(--ar-t1)}
.ar-hd-sub{margin:7px 0 0;font-size:13px;letter-spacing:.08em;color:var(--ar-t2)}
.ar-hd-eng{margin:5px 0 0;font-family:var(--ar-font-script);font-size:14px;font-weight:500;letter-spacing:.03em;color:rgba(199,162,116,.62)}
.ar-orn{display:flex;align-items:center;gap:9px;margin-top:13px}
.ar-orn i{flex:none;width:48px;height:1px;background:linear-gradient(90deg,transparent,rgba(201,163,106,.55))}
.ar-orn i:last-child{background:linear-gradient(90deg,rgba(201,163,106,.55),transparent)}
.ar-orn b{width:5px;height:5px;background:var(--ar-accent);transform:rotate(45deg);opacity:.85}

/* ---------- 角色页标 ---------- */
.ar-pgbar{display:flex;align-items:center;gap:8px;padding:10px 12px 4px}
.ar-pgbtn{flex:none;display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:999px;cursor:pointer;border:1px solid var(--ar-line);background:transparent;color:var(--ar-t3);transition:color .2s,border-color .2s}
.ar-pgbtn:hover{color:var(--ar-accent);border-color:rgba(201,163,106,.35)}
.ar-pgbtn:disabled{opacity:.25;pointer-events:none}
.ar-pgavs{flex:1;display:flex;align-items:center;justify-content:center;gap:12px}
.ar-pgav{padding:1px;border:0;background:transparent;cursor:pointer;line-height:0;border-radius:999px;opacity:.42;filter:saturate(.7);transition:all .25s ease}
.ar-pgav .ar-avx{border-radius:999px}
.ar-pgav.on{opacity:1;filter:none;transform:translateY(-1px);background:linear-gradient(150deg,#f7e6b8,rgba(206,168,112,.55));box-shadow:0 0 12px rgba(238,206,150,.22)}
.ar-pager{flex:1;overflow:hidden;position:relative;z-index:1;touch-action:pan-y}
.ar-track{display:flex;height:100%}
.ar-page{flex:0 0 100%;min-width:100%;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-bottom:36px;scrollbar-width:none;-ms-overflow-style:none}
.ar-page::-webkit-scrollbar,.ar-ebk-bd::-webkit-scrollbar,.ar-fp-row::-webkit-scrollbar{display:none}
.ar-char-hd{display:flex;align-items:center;gap:11px;padding:13px 22px 0}
.ar-avx{position:relative;flex:none;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:6px;font-family:var(--ar-font-display);font-weight:700;color:rgba(240,228,204,.95)}
.ar-avx img{width:100%;height:100%;object-fit:cover;display:block}
.ar-avx::after{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;box-shadow:inset 0 0 0 1px rgba(255,236,210,.12), inset 0 -8px 12px rgba(0,0,0,.30)}
.ar-char-hd .ar-avx{border-radius:999px}
.ar-char-name{margin:0;font-size:15px;font-weight:700;color:var(--ar-t1);letter-spacing:.02em}
.ar-char-meta{margin:2px 0 0;font-size:11px;color:var(--ar-t3);letter-spacing:.04em}

/* ---------- 番外 · 实木书柜 ---------- */
.ar-cab{position:relative;margin:16px 16px 12px;padding:30px 9px 9px;border-radius:14px;background:repeating-linear-gradient(0deg, rgba(0,0,0,.05) 0 1px, transparent 1px 4px), linear-gradient(180deg,#5e4530,#3c2b1d 16%,#34261a 78%,#231910);box-shadow:inset 0 1px 0 rgba(255,216,168,.30), inset 0 -3px 5px rgba(0,0,0,.55), 0 24px 60px -24px rgba(0,0,0,.78)}
.ar-plate{position:absolute;top:8px;left:50%;transform:translateX(-50%);padding:3px 12px;border-radius:3px;font-size:10px;font-weight:800;letter-spacing:.22em;color:#43300f;white-space:nowrap;background:linear-gradient(155deg,#f0d49a,#c79c52 38%,#8a6328 62%,#d8b46e);box-shadow:inset 0 1px 0 rgba(255,255,255,.55), inset 0 -1px 2px rgba(0,0,0,.40), 0 1px 2px rgba(0,0,0,.55)}
.ar-cab-inner{position:relative;border-radius:8px;padding:14px 10px 13px;overflow:hidden;background:linear-gradient(180deg,#181210,#110d09);box-shadow:inset 0 2px 16px rgba(0,0,0,.72), inset 0 0 0 1px rgba(0,0,0,.6)}
.ar-meas{height:0}
.ar-zlabel{padding:2px 14px 9px;font-size:9px;font-weight:800;letter-spacing:.26em;color:var(--ar-t3)}
.ar-shelf{margin:0 -10px 18px}
.ar-shelf:last-child{margin-bottom:4px}
.ar-shelf-books{position:relative;z-index:2;display:flex;align-items:flex-end;gap:7px;padding:8px 14px 0}
.ar-board{position:relative;z-index:3;height:13px;margin-top:-1px;background:repeating-linear-gradient(180deg, rgba(0,0,0,.07) 0 1px, transparent 1px 4px), linear-gradient(180deg,var(--ar-wood-hi),var(--ar-wood-mid) 42%,var(--ar-wood-lo));box-shadow:inset 0 2px 0 rgba(255,216,168,.22), inset 0 -3px 3px rgba(0,0,0,.5), 0 9px 14px -6px rgba(0,0,0,.62)}
.ar-spine{position:relative;flex:none;display:flex;align-items:center;justify-content:center;padding:0;border:0;cursor:pointer;border-radius:3px 3px 1px 1px;box-shadow:inset 1px 0 0 rgba(255,236,200,.16), inset -1px 0 0 rgba(0,0,0,.5), 3px 6px 8px -4px rgba(0,0,0,.62);transition:transform .18s ease, box-shadow .18s ease}
.ar-spine::before{content:'';position:absolute;inset:0;border-radius:inherit;z-index:1;background:linear-gradient(90deg, rgba(0,0,0,.42), rgba(255,248,230,.14) 14%, rgba(255,248,230,.05) 32%, rgba(0,0,0,.12) 68%, rgba(0,0,0,.5))}
.ar-spine::after{content:'';position:absolute;top:0;left:2px;right:2px;height:3px;border-radius:2px 2px 0 0;z-index:2;background:linear-gradient(180deg,#efe2c4,#c9b68d);box-shadow:0 1px 1px rgba(0,0,0,.4)}
.ar-gilt{position:absolute;left:4px;right:4px;height:1px;z-index:2;pointer-events:none;background:linear-gradient(90deg,transparent,rgba(226,190,128,.7),transparent)}
.ar-gilt.t{top:13px}.ar-gilt.b{bottom:17px}.ar-gilt.b2{bottom:13px;opacity:.5}
.ar-spine-title{position:relative;z-index:3;writing-mode:vertical-rl;text-orientation:mixed;font-family:var(--ar-font-display);font-weight:600;font-size:12.5px;letter-spacing:.1em;line-height:1.1;color:rgba(244,234,214,.92);text-shadow:0 1px 2px rgba(0,0,0,.55);max-height:calc(100% - 38px);overflow:hidden}
.ar-spine-title.two{font-size:11px;letter-spacing:.05em;line-height:1.2;max-height:calc(100% - 34px)}
.ar-spine-title.fadeout{-webkit-mask-image:linear-gradient(180deg,#000 74%,transparent 98%);mask-image:linear-gradient(180deg,#000 74%,transparent 98%)}
.ar-spine:hover{transform:translateY(-4px)}
.ar-spine:active{transform:translateY(-2px) scale(.985)}
.ar-spine:focus-visible{outline:2px solid var(--ar-accent);outline-offset:2px}
.ar-spine.lean{transform:rotate(-6deg);transform-origin:18% 100%}
.ar-spine.lean:hover{transform:rotate(-6deg) translateY(-3px)}
.ar-spine.pull{transform:translateY(-15px);box-shadow:inset 1px 0 0 rgba(255,236,200,.16), inset -1px 0 0 rgba(0,0,0,.5), 3px 18px 18px -8px rgba(0,0,0,.72);z-index:5}
.ar-spine.lean.pull{transform:rotate(-6deg) translateY(-15px)}
.ar-stack{display:flex;flex-direction:column;align-items:flex-end;margin-left:auto;padding-right:4px}
.ar-flat{position:relative;display:block;border-radius:2px;box-shadow:inset 0 1px 0 rgba(255,240,210,.18), inset 0 -2px 2px rgba(0,0,0,.42), 0 2px 3px rgba(0,0,0,.42)}
.ar-flat::after{content:'';position:absolute;left:9px;right:9px;top:50%;height:1px;background:rgba(226,190,128,.38)}

/* ---------- 谈心 · 漆面绗缝丝绒妆匣 ---------- */
.ar-velvet{background-color:var(--ar-velvet);background-image:radial-gradient(circle at 50% 30%, rgba(255,214,224,.06), transparent 72%),radial-gradient(circle, rgba(244,206,216,.34) 0.9px, transparent 1.9px),repeating-linear-gradient(45deg, rgba(0,0,0,.32) 0 1px, transparent 1px 24px),repeating-linear-gradient(135deg, rgba(255,224,232,.09) 0 1px, transparent 1px 24px);background-size:auto, 24px 24px, auto, auto;background-position:0 0, 12px 12px, 0 0, 0 0}
.ar-lacq{background:linear-gradient(115deg, rgba(255,205,222,.10), transparent 40%),linear-gradient(180deg,#553240,#3a2029 46%,#241318)}
.ar-kbox{position:relative;margin:16px 16px 34px}
.ar-klid{position:relative;z-index:1;height:46px;margin:0 16px -7px;border-radius:9px 9px 4px 4px;display:flex;align-items:center;justify-content:center;transform:perspective(440px) rotateX(48deg);transform-origin:50% 100%;box-shadow:inset 0 0 0 1px rgba(216,170,118,.32), inset 0 0 0 5px rgba(18,8,12,.35), 0 -4px 10px rgba(0,0,0,.3)}
.ar-klid::after{content:'';position:absolute;inset:0;border-radius:inherit;background:linear-gradient(180deg, rgba(0,0,0,.36), rgba(0,0,0,0) 75%)}
.ar-klid svg{position:relative;z-index:2;opacity:.6}
.ar-kbody{position:relative;z-index:2;border-radius:13px;padding:9px;box-shadow:0 24px 60px -24px rgba(0,0,0,.78), inset 0 1px 0 rgba(255,214,228,.18), inset 0 0 0 1px rgba(216,170,118,.26)}
.ar-kwell{position:relative;display:flex;align-items:flex-end;gap:10px;overflow:hidden;border-radius:7px;padding:14px 12px 0;margin-bottom:8px;box-shadow:inset 0 5px 12px rgba(0,0,0,.62), inset 0 -7px 10px rgba(0,0,0,.48), inset 0 0 0 1px rgba(0,0,0,.5)}
.ar-kwell:last-of-type{margin-bottom:0}
.ar-krim{position:relative;height:36px;margin:9px -9px -9px;border-radius:0 0 13px 13px;background:linear-gradient(180deg,#4e2c38,#241218);box-shadow:inset 0 1px 0 rgba(216,170,118,.30), inset 0 -3px 5px rgba(0,0,0,.5)}
.ar-kclasp{position:absolute;top:-9px;left:50%;transform:translateX(-50%);line-height:0;filter:drop-shadow(0 2px 2px rgba(0,0,0,.55))}
.ar-kcount{position:absolute;right:15px;top:50%;transform:translateY(-50%);font-size:9px;font-weight:800;letter-spacing:.22em;color:rgba(224,184,156,.72)}
.ar-khinge{position:absolute;left:15px;top:50%;transform:translateY(-50%);display:flex;gap:5px}
.ar-khinge i{width:3px;height:3px;border-radius:999px;background:linear-gradient(180deg,#e8c98a,#8a6328);box-shadow:0 1px 1px rgba(0,0,0,.6)}
.ar-dcard{position:relative;flex:none;width:92px;height:118px;margin-bottom:-12px;padding:16px 0 0;border:0;background:transparent;cursor:pointer;transform:rotate(var(--rot,0deg));transition:transform .18s ease}
.ar-dcard-tab{position:absolute;top:1px;width:34px;height:17px;border-radius:5px 5px 0 0;display:flex;align-items:center;justify-content:center;background:linear-gradient(180deg,#e9dcbe,#d6c6a2);box-shadow:inset 0 1px 0 rgba(255,255,255,.5), 0 -1px 2px rgba(0,0,0,.25)}
.ar-dcard-body{position:relative;display:block;height:102px;overflow:hidden;border-radius:4px 4px 0 0;padding:9px 9px 0;text-align:left;background:linear-gradient(180deg,#e8dabd,#dccaa7 70%,#cdba94);box-shadow:inset 0 0 0 1px rgba(120,90,50,.28), inset 0 -10px 14px rgba(110,80,40,.20), 0 4px 8px rgba(0,0,0,.5)}
.ar-dcard-lines{position:absolute;left:0;right:0;top:54px;bottom:0;pointer-events:none;background:repeating-linear-gradient(180deg, transparent 0 13px, rgba(90,110,150,.16) 13px 14px)}
.ar-dcard-title{position:relative;z-index:2;margin:0;font-size:12px;line-height:1.35;font-weight:700;color:#3c3122;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ar-dcard-rule{display:block;height:1px;margin:6px -9px 7px;background:rgba(178,92,84,.5)}
.ar-dcard-foot{position:relative;z-index:2;display:flex;align-items:flex-end;gap:2px;height:17px}
.ar-dcard-foot em{margin-left:auto;font-style:normal;font-size:9px;color:#6b5a43;letter-spacing:.04em}
.ar-wbar{width:2px;border-radius:1px;background:var(--ar-rose);opacity:.85}
.ar-dcard:hover{transform:rotate(var(--rot,0deg)) translateY(-7px)}
.ar-dcard:active{transform:rotate(var(--rot,0deg)) translateY(-4px) scale(.99)}
.ar-dcard:focus-visible{outline:2px solid var(--ar-accent);outline-offset:2px}
.ar-dcard.pull{transform:translateY(-16px)}

/* ---------- 阅读器 · 小电子书 ---------- */
.ar-veil{position:fixed;inset:0;z-index:100;display:flex;justify-content:center;background:rgba(8,5,3,.66);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);animation:ar-fade .2s ease}
.ar-veil.book{align-items:center;padding:20px 16px}
.ar-veil.bottom{align-items:flex-end;padding:0 10px}
.ar-veil.center{align-items:center;padding:26px}
.ar-veil.over{z-index:130}
@keyframes ar-fade{from{opacity:0}}
@keyframes ar-rise{from{transform:translateY(30px);opacity:0}}
@keyframes ar-bookin{from{opacity:0;transform:perspective(900px) rotateY(-14deg) translateY(22px)}}
.ar-ebk-wrap{display:flex;flex-direction:column;align-items:center;gap:15px;width:100%;max-width:430px}
.ar-ebk{position:relative;width:min(80vw,322px);height:min(64dvh,520px);min-height:380px;border-radius:5px 13px 13px 5px;padding:9px 12px 13px 21px;box-shadow:0 24px 60px -24px rgba(0,0,0,.78), inset 0 1px 0 rgba(255,236,200,.16);animation:ar-bookin .34s cubic-bezier(.2,.85,.3,1)}
.ar-ebk::before{content:'';position:absolute;left:0;top:0;bottom:0;width:14px;border-radius:5px 0 0 5px;background:linear-gradient(90deg, rgba(0,0,0,.5), rgba(255,240,210,.12) 55%, rgba(0,0,0,.38))}
.ar-ebk-x{position:absolute;top:-10px;right:-10px;z-index:5;display:flex;align-items:center;justify-content:center;width:31px;height:31px;border-radius:999px;cursor:pointer;border:1px solid rgba(201,163,106,.3);background:rgba(12,10,8,.92);color:var(--ar-t2)}
.ar-ebk-x:hover{color:var(--ar-t1);border-color:rgba(201,163,106,.55)}
.ar-ebk-page{position:relative;display:flex;flex-direction:column;height:100%;overflow:hidden;border-radius:2px 7px 7px 2px;background:linear-gradient(90deg,#dfcfab,#efe3c8 12%,#ece0c2);box-shadow:inset 9px 0 12px -9px rgba(90,60,30,.5),1.5px 1.5px 0 #d8c9a6,3px 3px 0 #c9b88f,4.5px 4.5px 0 #b3a176,7px 9px 16px rgba(0,0,0,.45)}
.ar-ebk-page::after{content:'';position:absolute;inset:0;pointer-events:none;background-image:${NOISE};opacity:.04}
.ar-ebk-hd{padding:20px 18px 0;text-align:center}
.ar-ebk-kind{margin:0;font-size:9.5px;font-weight:800;letter-spacing:.34em;color:#6b5a43}
.ar-ebk-title{margin:9px 0 0;font-family:var(--ar-font-display);font-weight:700;font-size:20px;line-height:1.35;color:#3c3122}
.ar-ebk-orn{display:flex;align-items:center;justify-content:center;gap:7px;margin:12px 0 2px}
.ar-ebk-orn i{width:30px;height:1px;background:linear-gradient(90deg,transparent,rgba(110,80,40,.5))}
.ar-ebk-orn i:last-child{background:linear-gradient(90deg,rgba(110,80,40,.5),transparent)}
.ar-ebk-orn b{width:4px;height:4px;background:rgba(110,80,40,.55);transform:rotate(45deg)}
.ar-ebk-bd{flex:1;overflow-y:auto;padding:8px 19px 12px;font-family:var(--ar-font-display);font-size:14.5px;line-height:2.05;color:#43361f;white-space:pre-wrap;scrollbar-width:none;-ms-overflow-style:none}
.ar-ebk-ft{padding:9px 14px 11px;text-align:center;font-size:9.5px;letter-spacing:.2em;color:#6b5a43;border-top:1px solid rgba(110,80,40,.18)}
.ar-ebk-acts{display:flex;gap:9px}
.ar-ract{display:flex;align-items:center;gap:6px;height:36px;padding:0 16px;border-radius:999px;cursor:pointer;border:1px solid rgba(201,163,106,.26);background:rgba(12,10,8,.9);color:rgba(222,202,172,.85);font-size:12px;font-weight:700;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);transition:border-color .2s,color .2s,transform .12s}
.ar-ract:hover{border-color:rgba(201,163,106,.55);color:var(--ar-t1)}
.ar-ract:active{transform:scale(.96)}
.ar-ract.danger{color:rgba(216,152,142,.85);border-color:rgba(180,100,90,.34)}
.ar-ract.danger:hover{color:#e6b3a8;border-color:rgba(200,110,96,.6)}
.ar-panel{width:100%;max-width:430px;border:1px solid var(--ar-line);border-bottom:0;border-radius:18px 18px 0 0;background:var(--ar-surface);box-shadow:0 24px 60px -24px rgba(0,0,0,.78);animation:ar-rise .24s cubic-bezier(.2,.9,.3,1);padding-bottom:calc(env(safe-area-inset-bottom, 0px) + 6px)}
.ar-panel-hd{display:flex;align-items:center;justify-content:space-between;padding:15px 18px 11px}
.ar-panel-hd h3{margin:0;font-size:15px;font-weight:800;color:var(--ar-t1)}
.ar-panel-hd p{margin:3px 0 0;font-size:11px;color:var(--ar-t3)}
.ar-crow{display:flex;align-items:center;gap:12px;width:100%;padding:12px 18px;border:0;border-top:1px solid var(--ar-line);background:transparent;text-align:left;cursor:pointer;color:var(--ar-t1)}
.ar-crow:hover{background:var(--ar-surface-2)}
.ar-crow b{display:block;font-size:14px;font-weight:700}
.ar-crow small{display:block;margin-top:2px;font-size:11px;color:var(--ar-t3)}
.ar-crow svg{margin-left:auto;color:var(--ar-t3)}
.ar-fpanel{position:relative;width:100%;max-width:430px;overflow:hidden;border-radius:20px 20px 0 0;padding-bottom:calc(env(safe-area-inset-bottom, 0px) + 16px);background:linear-gradient(180deg,#251822 0%,#1b1116 58%,#150d11 100%);box-shadow:0 24px 60px -24px rgba(0,0,0,.78), inset 0 1px 0 rgba(255,214,228,.15), inset 0 0 0 1px rgba(216,170,118,.16);animation:ar-rise .24s cubic-bezier(.2,.9,.3,1)}
.ar-fpanel::before{content:'';position:absolute;inset:0;pointer-events:none;background-image:${NOISE};opacity:.04}
.ar-fp-x{position:absolute;top:13px;right:13px;z-index:3;display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:999px;border:1px solid var(--ar-line);background:transparent;color:var(--ar-t3);cursor:pointer}
.ar-fp-x:hover{color:var(--ar-t1);border-color:rgba(216,170,118,.4)}
.ar-fp-hd{padding:19px 20px 0;text-align:center}
.ar-fp-title{margin:0;font-family:var(--ar-font-display);font-weight:700;font-size:18px;letter-spacing:.08em;color:var(--ar-t1)}
.ar-fp-orn{display:flex;align-items:center;justify-content:center;gap:7px;margin-top:10px}
.ar-fp-orn i{width:34px;height:1px;background:linear-gradient(90deg,transparent,rgba(216,170,118,.5))}
.ar-fp-orn i:last-child{background:linear-gradient(90deg,rgba(216,170,118,.5),transparent)}
.ar-fp-orn b{width:4px;height:4px;background:rgba(216,170,118,.7);transform:rotate(45deg)}
.ar-fp-card{display:flex;align-items:center;gap:13px;margin:15px 20px 4px;padding:11px;border-radius:14px;background:rgba(255,224,232,.04);box-shadow:inset 0 0 0 1px rgba(216,170,118,.15)}
.ar-fp-cover{flex:none;width:52px;height:68px;border-radius:6px;overflow:hidden;box-shadow:0 5px 12px rgba(0,0,0,.55), inset 0 0 0 1px rgba(255,236,210,.14)}
.ar-fp-cover img{width:100%;height:100%;object-fit:cover;display:block}
.ar-fp-fb{display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-family:var(--ar-font-display);font-weight:700;font-size:22px;color:rgba(240,228,204,.95)}
.ar-fp-bt{margin:0;font-size:13.5px;font-weight:700;color:var(--ar-t1);display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}
.ar-fp-bs{margin:4px 0 0;font-size:11px;color:var(--ar-t2)}
.ar-fp-sec{margin:13px 22px 2px;font-size:9.5px;font-weight:800;letter-spacing:.26em;color:var(--ar-t3)}
.ar-fp-row{display:flex;gap:11px;padding:9px 20px 4px;overflow-x:auto;scroll-snap-type:x proximity;scrollbar-width:none;-ms-overflow-style:none}
.ar-fcand{flex:none;width:96px;display:flex;flex-direction:column;align-items:center;gap:8px;padding:13px 8px 12px;border-radius:16px;cursor:pointer;scroll-snap-align:center;border:1px solid rgba(216,170,118,.16);background:rgba(255,236,210,.03);transition:all .2s ease}
.ar-fcand:hover{transform:translateY(-2px);border-color:rgba(216,170,118,.42);background:rgba(255,224,232,.06)}
.ar-fcand:active{transform:translateY(0) scale(.97)}
.ar-fcand:focus-visible{outline:2px solid var(--ar-accent);outline-offset:2px}
.ar-fring{padding:1px;border-radius:999px;line-height:0;background:linear-gradient(150deg,#f7e6b8 0%,rgba(240,214,160,.85) 38%,rgba(206,168,112,.5) 100%);box-shadow:0 0 10px rgba(238,206,150,.16)}
.ar-fring .ar-avx{border-radius:999px}
.ar-fcand b{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:700;color:var(--ar-t1)}
.ar-fcand small{font-size:9px;letter-spacing:.1em;color:var(--ar-t3)}
.ar-fseal{display:flex;align-items:center;justify-content:center;width:19px;height:19px;border-radius:999px;background:radial-gradient(circle at 35% 30%, #c98a96, #8e5560 72%);box-shadow:inset 0 -2px 3px rgba(0,0,0,.4), inset 0 1px 1px rgba(255,255,255,.3), 0 1px 2px rgba(0,0,0,.45)}
.ar-tin{width:100%;height:46px;padding:0 13px;border-radius:12px;border:1px solid var(--ar-line);background:#130e0a;color:var(--ar-t1);font-size:14px;font-weight:600;outline:none;font-family:inherit}
.ar-tin:focus{border-color:rgba(201,163,106,.55);box-shadow:0 0 0 3px rgba(201,163,106,.14)}
.ar-tin::placeholder{color:var(--ar-t3)}
.ar-btnrow{display:flex;gap:9px;padding:13px 18px 8px}
.ar-gbtn{display:flex;align-items:center;justify-content:center;gap:6px;height:40px;padding:0 16px;border-radius:999px;cursor:pointer;border:1px solid var(--ar-line);background:transparent;color:var(--ar-t2);font-size:12.5px;font-weight:700}
.ar-gbtn:hover{background:var(--ar-surface-2)}
.ar-abtn{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;height:40px;border-radius:999px;cursor:pointer;border:0;background:linear-gradient(180deg,#d2ab6e,#a87f43);color:#241704;font-size:13px;font-weight:800;box-shadow:inset 0 1px 0 rgba(255,255,255,.4)}
.ar-abtn:disabled{opacity:.6;cursor:wait}
.ar-dbtn{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;height:40px;border-radius:999px;cursor:pointer;border:0;background:#7c352b;color:#f4ddd2;font-size:13px;font-weight:800}
.ar-panel-c{width:100%;max-width:320px;border:1px solid var(--ar-line);border-radius:16px;background:var(--ar-surface);box-shadow:0 24px 60px -24px rgba(0,0,0,.78);animation:ar-rise .22s cubic-bezier(.2,.9,.3,1);padding:20px 18px 14px}
.ar-panel-c h3{margin:0;font-size:16px;font-weight:800;color:var(--ar-t1)}
.ar-panel-c p{margin:8px 0 2px;font-size:12.5px;line-height:1.7;color:var(--ar-t2)}
.ar-toast{position:fixed;left:50%;bottom:30px;transform:translateX(-50%);z-index:300;padding:9px 17px;border-radius:999px;border:1px solid rgba(201,163,106,.38);background:#241b12;color:var(--ar-t1);font-size:12.5px;font-weight:700;letter-spacing:.02em;box-shadow:0 24px 60px -24px rgba(0,0,0,.78);animation:ar-rise .22s ease}
.ar-sk-spine{flex:none;border-radius:3px 3px 1px 1px;background:linear-gradient(100deg,#241b13 38%,#32271c 50%,#241b13 62%);background-size:220% 100%;animation:ar-shimmer 1.4s ease infinite}
@keyframes ar-shimmer{from{background-position:120% 0}to{background-position:-120% 0}}
.ar-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 40px;text-align:center}
.ar-empty h2{margin:14px 0 0;font-family:var(--ar-font-display);font-weight:600;font-size:20px;letter-spacing:.1em;color:var(--ar-accent)}
.ar-empty p{margin:10px 0 0;font-size:13px;line-height:2;color:var(--ar-t3)}
@media (prefers-reduced-motion: reduce){
  .ar-exit,.ar-spine,.ar-dcard,.ar-pager,.ar-track,.ar-ebk,.ar-veil,.ar-panel,.ar-fpanel,.ar-fcand,.ar-panel-c,.ar-toast{animation:none!important;transition:none!important}
}
`;

/* ============================================================
   Utilities
   ============================================================ */

const CLOTH = ['#5d3a33', '#33453c', '#39435c', '#4a3a52', '#5a4a30', '#54393f'];

function seededIndex(value: string, length: number): number {
    if (length <= 0) return 0;
    const seed = Array.from(value || 'collection').reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return seed % length;
}

function selectGeneratedGalleryCover(images: GalleryImage[], seed: string): GalleryImage | null {
    const generatedImages = images
        .filter(image => Boolean(image.photoMeta && getGalleryImageDisplayUrl(image)))
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    if (generatedImages.length === 0) return null;
    const recentPool = generatedImages.slice(0, Math.min(6, generatedImages.length));
    return recentPool[seededIndex(seed, recentPool.length)] || recentPool[0] || null;
}

async function resolveCollectionForwardCover(book: CollectionBook, targetCharId?: string): Promise<{
    coverImageId?: string;
    coverImageUrl?: string;
    coverImageAlt?: string;
}> {
    const readIds: string[] = [];
    const addReadId = (id?: string) => {
        const normalized = String(id || '').trim();
        if (normalized && !readIds.includes(normalized)) readIds.push(normalized);
    };
    addReadId(book.charId);
    addReadId(targetCharId);
    for (const charId of [...readIds]) {
        try { addReadId(await DB.resolveCharacterContentId(charId)); } catch { /* cover optional */ }
    }
    for (const charId of readIds) {
        try {
            const gallery = await DB.getGalleryImages(charId);
            const cover = selectGeneratedGalleryCover(gallery, book.id || book.title);
            if (cover) {
                return {
                    coverImageId: cover.id,
                    coverImageUrl: getGalleryImageDisplayUrl(cover),
                    coverImageAlt: cover.visualSummary,
                };
            }
        } catch { /* try next */ }
    }
    return {};
}

const hashOf = (s: string): number => {
    let h = 7;
    for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h;
};

type HallCharacter = {
    id: string;
    name: string;
    avatar?: string;
};

const isImageUrl = (value: string): boolean => {
    const normalized = value.trim();
    return /^(data:image\/|blob:|https?:\/\/|\/)/i.test(normalized);
};

function findImageUrl(value: unknown, depth = 0): string {
    if (depth > 2 || value == null) return '';
    if (typeof value === 'string') return isImageUrl(value) ? value.trim() : '';
    if (typeof value !== 'object') return '';

    const record = value as Record<string, unknown>;
    const priority = ['coverImageUrl', 'imageUrl', 'displayUrl', 'url', 'src', 'thumbnailUrl'];
    for (const key of priority) {
        const direct = findImageUrl(record[key], depth + 1);
        if (direct) return direct;
    }
    for (const nested of Object.values(record)) {
        const found = findImageUrl(nested, depth + 1);
        if (found) return found;
    }
    return '';
}

const clothBg = (c: string): string =>
    `linear-gradient(180deg, color-mix(in srgb, ${c} 86%, #f1e2c2) 0%, ${c} 16%, color-mix(in srgb, ${c} 70%, #000) 100%)`;

const coverOf = (book: CollectionBook): string =>
    book.kind === 'heart_talk' ? '#4d2a37' : CLOTH[hashOf(book.id + book.title) % CLOTH.length];

const waveOf = (id: string): number[] =>
    Array.from({ length: 9 }, (_, i) => 5 + (hashOf(id + ':' + i) % 11));

const fmtDate = (ts: number): string => {
    const d = new Date(ts);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

const stripHtml = (html: string): string => {
    return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
};

interface Metrics {
    w: number;
    h: number;
    cloth: string;
    leanSeed: boolean;
}

const metricsOf = (book: CollectionBook): Metrics => {
    const h = hashOf(book.id + book.title);
    return {
        w: 28 + (h % 19),
        h: 132 + ((h >> 4) % 52),
        cloth: CLOTH[h % CLOTH.length],
        leanSeed: h % 6 === 1,
    };
};

interface ShelfItem {
    book: CollectionBook;
    m: Metrics;
    lean: boolean;
}

interface ShelfRow {
    items: ShelfItem[];
    leftover: number;
    last: boolean;
}

function packShelves(books: CollectionBook[], usable: number, gap = 7): ShelfRow[] {
    const rows: { book: CollectionBook; m: Metrics }[][] = [];
    let cur: { book: CollectionBook; m: Metrics }[] = [];
    let curW = 0;
    for (const book of books) {
        const m = metricsOf(book);
        const need = m.w + (cur.length ? gap : 0);
        if (cur.length && curW + need > usable) {
            rows.push(cur);
            cur = [];
            curW = 0;
        }
        cur.push({ book, m });
        curW += cur.length === 1 ? m.w : need;
    }
    if (cur.length) rows.push(cur);
    return rows.map((row, ri) => {
        const items: ShelfItem[] = row.map((it, i) => ({
            ...it,
            lean: it.m.leanSeed && i > 0 && row[i - 1].m.h >= it.m.h - 6,
        }));
        const width = items.reduce((s, it, i) => s + it.m.w + (i ? gap : 0), 0);
        return { items, leftover: usable - width, last: ri === rows.length - 1 };
    });
}

const chunk = <T,>(arr: T[], n: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += Math.max(1, n)) out.push(arr.slice(i, i + Math.max(1, n)));
    return out;
};

function useWidth(ref: React.RefObject<HTMLDivElement | null>, fallback = 372) {
    const [w, setW] = useState(fallback);
    useEffect(() => {
        const el = ref.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver((entries) => {
            for (const e of entries) setW(e.contentRect.width || fallback);
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, [ref, fallback]);
    return w;
}

const TAB_POS = [{ left: 7 }, { left: 29 }, { right: 7 }] as const;

/* ============================================================
   Sub-components
   ============================================================ */

const Avatar: React.FC<{ char: HallCharacter; hue: number; size?: number }> = ({ char: c, hue: hueVal, size = 38 }) => (
    <span
        className="ar-avx"
        style={{
            width: size, height: size, fontSize: size * 0.46,
            background: `linear-gradient(140deg, hsl(${hueVal} 30% 27%), hsl(${hueVal} 34% 13%))`,
        }}
        aria-hidden="true"
    >
        {c.avatar ? <img src={c.avatar} alt="" /> : c.name[0]}
    </span>
);

const Chev: React.FC<{ flip?: boolean }> = ({ flip }) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
        strokeLinecap="round" strokeLinejoin="round" style={flip ? { transform: 'scaleX(-1)' } : undefined} aria-hidden="true">
        <path d="M9 18l6-6-6-6" />
    </svg>
);

const HeartGlyph: React.FC = () => (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="#a06068" aria-hidden="true">
        <path d="M12 21s-7.6-4.8-10.1-9.4C.3 8 2 4.4 5.7 4c2.4-.3 4.4 1.3 6.3 3.6C13.9 5.3 15.9 3.7 18.3 4 22 4.4 23.7 8 22.1 11.6 19.6 16.2 12 21 12 21z" />
    </svg>
);

const ClaspHeart: React.FC = () => (
    <svg width="17" height="16" viewBox="0 0 24 22" aria-hidden="true">
        <defs>
            <linearGradient id="ar-claspGold" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#f0d49a" /><stop offset=".55" stopColor="#c79c52" /><stop offset="1" stopColor="#8a6328" />
            </linearGradient>
        </defs>
        <path d="M12 21S2.8 15.2.7 9.9C-.7 5.4 2 1.6 5.9 1.1c2.5-.3 4.6 1.4 6.1 3.7C13.5 2.5 15.6.8 18.1 1.1 22 1.6 24.7 5.4 23.3 9.9 21.2 15.2 12 21 12 21z"
            fill="url(#ar-claspGold)" stroke="rgba(40,22,8,.55)" strokeWidth="1" />
    </svg>
);

const WaxHeart: React.FC = () => (
    <svg width="9" height="8" viewBox="0 0 24 22" fill="rgba(248,232,236,.92)" aria-hidden="true">
        <path d="M12 21S2.8 15.2.7 9.9C-.7 5.4 2 1.6 5.9 1.1c2.5-.3 4.6 1.4 6.1 3.7C13.5 2.5 15.6.8 18.1 1.1 22 1.6 24.7 5.4 23.3 9.9 21.2 15.2 12 21 12 21z" />
    </svg>
);

const LidHeart: React.FC = () => (
    <svg width="15" height="14" viewBox="0 0 24 22" fill="none" stroke="rgba(222,178,142,.8)" strokeWidth="1.4" aria-hidden="true">
        <path d="M12 20S3.6 14.8 1.7 10C.4 5.9 2.8 2.5 6.3 2.1c2.2-.3 4.2 1.2 5.7 3.3 1.5-2.1 3.5-3.6 5.7-3.3 3.5.4 5.9 3.8 4.6 7.9C20.4 14.8 12 20 12 20z" />
    </svg>
);

const Spine: React.FC<{ book: CollectionBook; lean: boolean; pulling: boolean; onPick: (book: CollectionBook) => void }> = ({ book, lean, pulling, onPick }) => {
    const m = metricsOf(book);
    const title = getCollectionDisplayTitle(book);
    const titleClassName = [
        'ar-spine-title',
        title.length > 8 ? 'two' : '',
        title.length > 14 ? 'fadeout' : '',
    ].filter(Boolean).join(' ');
    return (
        <button
            type="button"
            className={`ar-spine${lean ? ' lean' : ''}${pulling ? ' pull' : ''}`}
            style={{ width: m.w, height: m.h, background: clothBg(m.cloth), backgroundColor: m.cloth }}
            title={title}
            aria-label={`打开《${title}》`}
            onClick={() => onPick(book)}
        >
            <i className="ar-gilt t" /><i className="ar-gilt b" /><i className="ar-gilt b2" />
            <span className={titleClassName}>{title}</span>
        </button>
    );
};

const FlatStack: React.FC<{ seed: string }> = ({ seed }) => {
    const h = hashOf(seed);
    const n = 2 + (h % 2);
    return (
        <div className="ar-stack" aria-hidden="true">
            {Array.from({ length: n }, (_, i) => {
                const hh = hashOf(seed + i);
                return (
                    <span
                        key={i}
                        className="ar-flat"
                        style={{
                            width: 60 + (hh % 18),
                            height: 11 + (hh % 3),
                            background: clothBg(CLOTH[hh % CLOTH.length]),
                            backgroundColor: CLOTH[hh % CLOTH.length],
                            transform: `translateX(${-(hh % 7)}px)`,
                        }}
                    />
                );
            })}
        </div>
    );
};

const ShelfZone: React.FC<{ books: CollectionBook[]; usable: number; pullingId: string | null; onPick: (book: CollectionBook) => void }> = ({ books, usable, pullingId, onPick }) => (
    <>
        {packShelves(books, usable).map((row, ri) => (
            <div className="ar-shelf" key={ri}>
                <div className="ar-shelf-books">
                    {row.items.map(({ book, lean }) => (
                        <Spine key={book.id} book={book} lean={lean} pulling={pullingId === book.id} onPick={onPick} />
                    ))}
                    {row.last && row.leftover >= 84 && <FlatStack seed={books[0].charId + ri} />}
                </div>
                <div className="ar-board" />
            </div>
        ))}
    </>
);

const BookCabinet: React.FC<{ char: HallCharacter; books: CollectionBook[]; pullingId: string | null; onPick: (book: CollectionBook) => void }> = ({ char, books, pullingId, onPick }) => {
    const mref = useRef<HTMLDivElement>(null);
    const w = useWidth(mref);
    return (
        <section className="ar-cab">
            <span className="ar-plate">{char.name}</span>
            <div className="ar-cab-inner">
                <div className="ar-meas" ref={mref} />
                <div className="ar-zlabel">番外典藏 · {books.length}</div>
                <ShelfZone books={books} usable={Math.max(220, w - 8)} pullingId={pullingId} onPick={onPick} />
            </div>
        </section>
    );
};

const KeepsakeBox: React.FC<{ books: CollectionBook[]; pullingId: string | null; onPick: (book: CollectionBook) => void }> = ({ books, pullingId, onPick }) => {
    const mref = useRef<HTMLDivElement>(null);
    const w = useWidth(mref, 340);
    const per = Math.max(1, Math.floor((w - 24 + 10) / 102));
    const rows = chunk(books, per);
    return (
        <section className="ar-kbox">
            <div className="ar-klid ar-velvet"><LidHeart /></div>
            <div className="ar-kbody ar-lacq">
                <div className="ar-meas" ref={mref} />
                {rows.map((rowBooks, ri) => (
                    <div className="ar-kwell ar-velvet" key={ri}>
                        {rowBooks.map((book, i) => {
                            const title = getCollectionDisplayTitle(book);
                            return (
                                <button
                                    type="button"
                                    key={book.id}
                                    className={`ar-dcard${pullingId === book.id ? ' pull' : ''}`}
                                    style={{ '--rot': `${((i % 3) - 1) * 0.8}deg` } as React.CSSProperties}
                                    title={title}
                                    aria-label={`打开谈心《${title}》`}
                                    onClick={() => onPick(book)}
                                >
                                    <span className="ar-dcard-tab" style={TAB_POS[i % 3]}><HeartGlyph /></span>
                                    <span className="ar-dcard-body">
                                        <span className="ar-dcard-lines" />
                                        <span className="ar-dcard-title">{title}</span>
                                        <span className="ar-dcard-rule" />
                                        <span className="ar-dcard-foot">
                                            {waveOf(book.id).map((bh, bi) => (
                                                <i key={bi} className="ar-wbar" style={{ height: bh }} />
                                            ))}
                                            <em>{fmtDate(book.collectedAt).slice(5)}</em>
                                        </span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                ))}
                <div className="ar-krim">
                    <span className="ar-khinge" aria-hidden="true"><i /><i /></span>
                    <span className="ar-kclasp"><ClaspHeart /></span>
                    <span className="ar-kcount">谈心 · {books.length} 张</span>
                </div>
            </div>
        </section>
    );
};

const SkeletonCabinet: React.FC = () => {
    const hs = [122, 138, 112, 146, 128, 116, 134, 142];
    return (
        <section className="ar-cab" aria-hidden="true" style={{ marginTop: 22 }}>
            <span className="ar-plate" style={{ color: 'transparent' }}>载入中</span>
            <div className="ar-cab-inner">
                {[0, 1].map((r) => (
                    <div className="ar-shelf" key={r}>
                        <div className="ar-shelf-books">
                            {hs.map((h, i) => (
                                <span key={i} className="ar-sk-spine" style={{ width: 30 + ((i * 5) % 15), height: h - r * 8 }} />
                            ))}
                        </div>
                        <div className="ar-board" />
                    </div>
                ))}
            </div>
        </section>
    );
};

const EbookReader: React.FC<{
    book: CollectionBook;
    char: { name: string } | undefined;
    onClose: () => void;
    onEdit: () => void;
    onForward: () => void;
    onDelete: () => void;
}> = ({ book, char, onClose, onEdit, onForward, onDelete }) => {
    const cover = coverOf(book);
    const title = getCollectionDisplayTitle(book);
    const bodyText = stripHtml(book.cardData?.body || book.body || '');
    return (
        <div className="ar-veil book" onClick={onClose}>
            <div className="ar-ebk-wrap" onClick={(e) => e.stopPropagation()}>
                <article className="ar-ebk" style={{ background: clothBg(cover), backgroundColor: cover }}>
                    <button type="button" className="ar-ebk-x" aria-label="合上" onClick={onClose}><X weight="bold" /></button>
                    <div className="ar-ebk-page">
                        <header className="ar-ebk-hd">
                            <p className="ar-ebk-kind">{formatCollectionKindLabel(book.kind)}</p>
                            <h2 className="ar-ebk-title">{title}</h2>
                            <div className="ar-ebk-orn"><i /><b /><i /></div>
                        </header>
                        <div className="ar-ebk-bd">{bodyText}</div>
                        <footer className="ar-ebk-ft">{char?.name || '已删除角色'} · 收藏于 {fmtDate(book.collectedAt)}</footer>
                    </div>
                </article>
                <div className="ar-ebk-acts">
                    <button type="button" className="ar-ract" onClick={onEdit}><PencilSimple weight="bold" />改标签</button>
                    <button type="button" className="ar-ract danger" onClick={onDelete}><Trash weight="bold" />删除</button>
                    <button type="button" className="ar-ract" onClick={onForward}><PaperPlaneTilt weight="bold" />转递</button>
                </div>
            </div>
        </div>
    );
};

const ForwardCoverPreview: React.FC<{
    book: CollectionBook;
    sourceChar?: HallCharacter;
    hue: number;
}> = ({ book, sourceChar, hue }) => {
    const coverUrl = useMemo(() => (
        findImageUrl(book.cover) || findImageUrl(book.cardData?.meta?.afterglowCover)
    ), [book]);
    const avatarUrl = sourceChar?.avatar?.trim() || '';
    const imageUrl = coverUrl || avatarUrl;
    const [failedUrl, setFailedUrl] = useState('');
    const visibleImageUrl = imageUrl && failedUrl !== imageUrl ? imageUrl : '';

    useEffect(() => {
        setFailedUrl('');
    }, [imageUrl]);

    return (
        <span className="ar-fp-cover">
            {visibleImageUrl ? (
                <img src={visibleImageUrl} alt="" onError={() => setFailedUrl(visibleImageUrl)} />
            ) : (
                <span
                    className="ar-fp-fb"
                    style={{ background: `linear-gradient(140deg, hsl(${hue} 30% 27%), hsl(${hue} 34% 13%))` }}
                >
                    {sourceChar?.name?.[0] || '·'}
                </span>
            )}
        </span>
    );
};

/* ============================================================
   Main App
   ============================================================ */

const CollectionHallApp: React.FC = () => {
    const { characters, openApp, closeApp } = useOS();
    const [books, setBooks] = useState<CollectionBook[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(0);
    const [drag, setDrag] = useState(0);
    const [selected, setSelected] = useState<CollectionBook | null>(null);
    const [pullingId, setPullingId] = useState<string | null>(null);
    const [editing, setEditing] = useState<{ book: CollectionBook; draft: string } | null>(null);
    const [saving, setSaving] = useState(false);
    const [forwardFor, setForwardFor] = useState<CollectionBook | null>(null);
    const [confirmDel, setConfirmDel] = useState<CollectionBook | null>(null);
    const [toast, setToast] = useState<{ key: number; msg: string } | null>(null);
    const touch = useRef({ x: 0, y: 0, axis: '' as 'h' | 'v' | '', on: false });

    const charById = useMemo(() => new Map(characters.map(c => [c.id, c])), [characters]);

    const loadBooks = useCallback(async () => {
        try {
            const next = await DB.getAllCollectionBooks();
            setBooks(next);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadBooks();
    }, [loadBooks]);

    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 2300);
        return () => clearTimeout(t);
    }, [toast]);

    const say = (msg: string) => setToast({ key: Date.now(), msg });

    const sections = useMemo(() => {
        const byChar = new Map<string, CollectionBook[]>();
        for (const b of books) {
            if (!byChar.has(b.charId)) byChar.set(b.charId, []);
            byChar.get(b.charId)!.push(b);
        }
        const orderedIds = [
            ...characters.map(c => c.id).filter(id => byChar.has(id)),
            ...Array.from(byChar.keys()).filter(id => !charById.has(id)),
        ];
        return orderedIds.map(charId => {
            const charBooks = (byChar.get(charId) || []).sort((a, b) => b.collectedAt - a.collectedAt);
            const character = charById.get(charId);
            return {
                char: character || { id: charId, name: '已删除角色' },
                hue: hashOf(charId) % 360,
                afterglow: charBooks.filter(b => b.kind !== 'heart_talk'),
                heartTalks: charBooks.filter(b => b.kind === 'heart_talk'),
            };
        });
    }, [books, characters, charById]);

    const safePage = Math.min(page, Math.max(0, sections.length - 1));

    useEffect(() => {
        if (page > Math.max(0, sections.length - 1)) setPage(Math.max(0, sections.length - 1));
    }, [sections.length, page]);

    const charOf = (b: CollectionBook) => charById.get(b.charId);

    const pick = (book: CollectionBook) => {
        if (pullingId) return;
        setPullingId(book.id);
        setTimeout(() => { setSelected(book); setPullingId(null); }, 200);
    };

    const onTS = (e: React.TouchEvent) => {
        const t = e.touches[0];
        touch.current = { x: t.clientX, y: t.clientY, axis: '', on: true };
    };

    const onTM = (e: React.TouchEvent) => {
        const s = touch.current;
        if (!s.on) return;
        const t = e.touches[0];
        const dx = t.clientX - s.x, dy = t.clientY - s.y;
        if (!s.axis) {
            if (Math.abs(dx) < 9 && Math.abs(dy) < 9) return;
            s.axis = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
        }
        if (s.axis !== 'h') return;
        let d = dx;
        if ((safePage === 0 && d > 0) || (safePage === sections.length - 1 && d < 0)) d *= 0.32;
        setDrag(d);
    };

    const onTE = () => {
        const s = touch.current;
        if (s.axis === 'h') {
            if (drag < -56 && safePage < sections.length - 1) setPage(safePage + 1);
            else if (drag > 56 && safePage > 0) setPage(safePage - 1);
        }
        setDrag(0);
        touch.current = { x: 0, y: 0, axis: '', on: false };
    };

    const handleSaveTitle = useCallback(async () => {
        if (!editing || saving) return;
        setSaving(true);
        try {
            const updated = await DB.updateCollectionBookTitle(editing.book.id, editing.draft);
            if (!updated) { say('这份典藏不见了'); setEditing(null); return; }
            setBooks(prev => prev.map(b => b.id === updated.id ? updated : b));
            setSelected(prev => prev?.id === updated.id ? updated : prev);
            setEditing(null);
            say(editing.draft.trim() ? '标签已贴好' : '已恢复默认标签');
        } catch {
            say('改标签失败，稍后再试');
        } finally {
            setSaving(false);
        }
    }, [editing, saving, say]);

    const handleDelete = useCallback(async () => {
        if (!confirmDel) return;
        try {
            await DB.deleteCollectionBook(confirmDel.id);
            setBooks(prev => prev.filter(b => b.id !== confirmDel.id));
            setConfirmDel(null);
            setSelected(null);
            say('已从典藏馆移出');
        } catch {
            say('删除失败，稍后再试');
        }
    }, [confirmDel, say]);

    const handleForward = useCallback(async (targetCharId: string) => {
        if (!forwardFor) return;
        const targetChar = characters.find(c => c.id === targetCharId);
        const sourceChar = charById.get(forwardFor.charId);
        try {
            const cover = await resolveCollectionForwardCover(forwardFor, targetCharId);
            const payload = buildCollectionForwardPayload(forwardFor, {
                charName: sourceChar?.name || '角色',
                charAvatar: sourceChar?.avatar || targetChar?.avatar,
                targetCharId,
                ...cover,
            });
            const messageId = await DB.saveMessage({
                charId: targetCharId,
                role: 'user',
                type: 'collection_forward',
                content: JSON.stringify(payload),
                metadata: { source: 'collection_hall', collectionForward: payload },
            });
            say(`已转递给 ${targetChar?.name || '角色'}`);
            setForwardFor(null);
            setSelected(null);
            openApp(AppID.Chat, {
                targetCharId,
                targetMessageId: messageId,
                targetRequestId: `collection-${Date.now()}`,
            });
        } catch {
            say('转递失败，稍后再试');
        }
    }, [forwardFor, characters, charById, openApp]);

    return (
        <div className="ar-root">
            <style>{CSS}</style>
            <div className="ar-grain" /><div className="ar-vig" />
            <button type="button" className="ar-exit" aria-label="退出典藏馆" onClick={closeApp}>
                <X weight="bold" size={15} />
            </button>

            <header className="ar-hd">
                <h1 className="ar-hd-title">The Archives</h1>
                <p className="ar-hd-sub">我所窥见的，你的灵魂</p>
                <p className="ar-hd-eng">the glimpses i&rsquo;ve caught of your soul</p>
                <div className="ar-orn"><i /><b /><i /></div>
            </header>

            {loading ? (
                <div className="ar-pager"><SkeletonCabinet /></div>
            ) : sections.length === 0 ? (
                <div className="ar-empty">
                    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#80705c" strokeWidth="1.4" aria-hidden="true">
                        <path d="M4 19V5a1 1 0 0 1 1-1h3v15H5a1 1 0 0 1-1-1zM8 4h4v15H8zM13.5 4.6l3.8-.8a1 1 0 0 1 1.2.8l2.4 13.6a1 1 0 0 1-.8 1.1l-3.8.7a1 1 0 0 1-1.1-.8L12.7 5.8a1 1 0 0 1 .8-1.2z" />
                    </svg>
                    <h2>典藏馆还空着</h2>
                    <p>去主聊天打开番外篇或谈心阅读器，点侧边的收藏按钮，这里就会为对应角色添上一本。</p>
                </div>
            ) : (
                <>
                    {sections.length > 1 && (
                        <div className="ar-pgbar">
                            <button type="button" className="ar-pgbtn" disabled={safePage === 0}
                                aria-label="上一位" onClick={() => setPage(safePage - 1)}><Chev flip /></button>
                            <div className="ar-pgavs">
                                {sections.map(({ char, hue }, i) => (
                                    <button type="button" key={char.id} className={`ar-pgav${i === safePage ? ' on' : ''}`}
                                        aria-label={`${char.name} 的典藏`} onClick={() => setPage(i)}>
                                        <Avatar char={char} hue={hue} size={27} />
                                    </button>
                                ))}
                            </div>
                            <button type="button" className="ar-pgbtn" disabled={safePage === sections.length - 1}
                                aria-label="下一位" onClick={() => setPage(safePage + 1)}><Chev /></button>
                        </div>
                    )}
                    <div className="ar-pager" onTouchStart={onTS} onTouchMove={onTM} onTouchEnd={onTE} onTouchCancel={onTE}>
                        <div
                            className="ar-track"
                            style={{
                                transform: `translateX(calc(${-safePage * 100}% + ${drag}px))`,
                                transition: drag !== 0 ? 'none' : 'transform .36s cubic-bezier(.22,.9,.28,1)',
                            }}
                        >
                            {sections.map(({ char, hue, afterglow, heartTalks }) => (
                                <div className="ar-page" key={char.id}>
                                    <div className="ar-char-hd">
                                        <Avatar char={char} hue={hue} size={36} />
                                        <div>
                                            <h2 className="ar-char-name">{char.name}</h2>
                                            <p className="ar-char-meta">
                                                {afterglow.length > 0 && `${afterglow.length} 本番外`}
                                                {afterglow.length > 0 && heartTalks.length > 0 && ' · '}
                                                {heartTalks.length > 0 && `${heartTalks.length} 张谈心`}
                                            </p>
                                        </div>
                                    </div>
                                    {afterglow.length > 0 && (
                                        <BookCabinet char={char} books={afterglow} pullingId={pullingId} onPick={pick} />
                                    )}
                                    {heartTalks.length > 0 && (
                                        <KeepsakeBox books={heartTalks} pullingId={pullingId} onPick={pick} />
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}

            {selected && (
                <EbookReader
                    book={selected}
                    char={charOf(selected)}
                    onClose={() => setSelected(null)}
                    onEdit={() => setEditing({ book: selected, draft: selected.customTitle?.trim() || getCollectionDisplayTitle(selected) })}
                    onForward={() => setForwardFor(selected)}
                    onDelete={() => setConfirmDel(selected)}
                />
            )}

            {forwardFor && (() => {
                const sourceChar = charOf(forwardFor);
                const sourceHue = hashOf(forwardFor.charId) % 360;
                return (
                <div className="ar-veil bottom over" onClick={() => setForwardFor(null)}>
                    <div className="ar-fpanel" onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="ar-fp-x" aria-label="关闭" onClick={() => setForwardFor(null)}><X weight="bold" size={14} /></button>
                        <div className="ar-fp-hd">
                            <h3 className="ar-fp-title">把这份心意转递给</h3>
                            <div className="ar-fp-orn"><i /><b /><i /></div>
                        </div>
                        <div className="ar-fp-card">
                            <ForwardCoverPreview book={forwardFor} sourceChar={sourceChar} hue={sourceHue} />
                            <span style={{ minWidth: 0 }}>
                                <p className="ar-fp-bt">《{getCollectionDisplayTitle(forwardFor)}》</p>
                                <p className="ar-fp-bs">{formatCollectionKindLabel(forwardFor.kind)} · 来自 {sourceChar?.name || '已删除角色'}</p>
                            </span>
                        </div>
                        <p className="ar-fp-sec">选一位收信人</p>
                        <div className="ar-fp-row">
                            {characters.map(c => {
                                const hue = hashOf(c.id) % 360;
                                return (
                                    <button type="button" key={c.id} className="ar-fcand" onClick={() => handleForward(c.id)}>
                                        <span className="ar-fring"><Avatar char={c} hue={hue} size={48} /></span>
                                        <b>{c.name}</b>
                                        <small>{c.id === forwardFor.charId ? '原角色' : '送达聊天'}</small>
                                        <span className="ar-fseal"><WaxHeart /></span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
                );
            })()}

            {editing && (
                <div className="ar-veil bottom over" onClick={() => setEditing(null)}>
                    <div className="ar-panel" onClick={(e) => e.stopPropagation()}>
                        <div className="ar-panel-hd">
                            <div>
                                <h3>{editing.book.kind === 'heart_talk' ? '重写谈心标签' : '重写书脊标签'}</h3>
                                <p>留空并保存即可恢复默认标签</p>
                            </div>
                        </div>
                        <div style={{ padding: '2px 18px 0' }}>
                            <input
                                className="ar-tin"
                                autoFocus
                                maxLength={32}
                                value={editing.draft}
                                placeholder={getCollectionDisplayTitle(editing.book)}
                                onChange={(e) => setEditing(prev => prev ? { ...prev, draft: e.target.value } : null)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveTitle(); }}
                            />
                        </div>
                        <div className="ar-btnrow">
                            <button type="button" className="ar-gbtn" onClick={() => setEditing(null)}><X weight="bold" />取消</button>
                            <button type="button" className="ar-abtn" disabled={saving} onClick={handleSaveTitle}>
                                <Check weight="bold" />{editing.draft.trim() ? '贴上' : '恢复默认'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {confirmDel && (
                <div className="ar-veil center over" onClick={() => setConfirmDel(null)}>
                    <div className="ar-panel-c" onClick={(e) => e.stopPropagation()}>
                        <h3>移出典藏馆？</h3>
                        <p>《{getCollectionDisplayTitle(confirmDel)}》会被删除，且无法恢复。</p>
                        <div className="ar-btnrow" style={{ padding: '14px 0 0' }}>
                            <button type="button" className="ar-gbtn" style={{ flex: 1 }} onClick={() => setConfirmDel(null)}>取消</button>
                            <button type="button" className="ar-dbtn" onClick={handleDelete}><Trash weight="bold" />移除</button>
                        </div>
                    </div>
                </div>
            )}

            {toast && <div className="ar-toast" key={toast.key}>{toast.msg}</div>}
        </div>
    );
};

export default CollectionHallApp;

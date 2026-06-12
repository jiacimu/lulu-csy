import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, PaperPlaneTilt, PencilSimple, Trash, X } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { AppID, type CollectionBook, type CollectionWall, type CollectionWallAsset, type CollectionWallItem, type GalleryImage } from '../types';
import { DB } from '../utils/db';
import {
    buildCollectionForwardPayload,
    formatCollectionKindLabel,
    getCollectionDisplayTitle,
} from '../utils/collectionBooks';
import { addCollectionWallPendingContext } from '../utils/collectionWallContext';
import { buildCharWallNoteItem, requestCharWallNote } from '../utils/collectionWallCoCreation';
import { hasWallEditorDraftChanges, serializeWallEditorDraft } from '../utils/collectionWallEditorDraft';
import { getGalleryImageDisplayUrl } from '../utils/generatedImageStorage';
import { STATUS_CARD_IFRAME_SHELL, STATUS_CARD_MEASURE_BUFFER_PX } from '../components/chat/statusCardIframe';
const StatusCardRenderer = React.lazy(() => import('../components/chat/StatusCardRenderer'));

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

/* ---------- 角色分区与拾光墙 ---------- */
.ar-seg{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:14px 16px 2px;padding:4px;border:1px solid rgba(201,163,106,.16);border-radius:999px;background:rgba(12,9,6,.36)}
.ar-seg button{height:32px;border:0;border-radius:999px;background:transparent;color:var(--ar-t3);font-size:12px;font-weight:900;letter-spacing:.08em;cursor:pointer;transition:color .18s,background .18s,box-shadow .18s}
.ar-seg button.on{background:linear-gradient(180deg,rgba(245,224,181,.18),rgba(201,163,106,.10));color:var(--ar-accent);box-shadow:inset 0 0 0 1px rgba(201,163,106,.28)}
.ar-section-empty{margin:18px 16px 34px;border:1px dashed rgba(201,163,106,.2);border-radius:10px;padding:22px 18px;text-align:center;color:var(--ar-t3);font-size:12px;line-height:1.9;background:rgba(255,236,210,.035)}
.ar-wall{position:relative;margin:18px 16px 28px;padding:18px 14px 16px;overflow:hidden;border-radius:10px;background:linear-gradient(145deg,#f5efe2,#efe7d6);box-shadow:0 22px 54px -28px rgba(0,0,0,.78),inset 0 0 0 1px rgba(255,255,255,.50)}
.ar-wall::before,.ar-wall-card::before{content:'';position:absolute;inset:0;pointer-events:none;background-image:${NOISE};opacity:.038;mix-blend-mode:multiply}
.ar-wall-top{position:relative;z-index:1;display:flex;align-items:flex-start;justify-content:space-between;gap:14px;border-bottom:1px solid rgba(63,48,31,.14);padding-bottom:12px}
.ar-wall-kicker{margin:0;font-size:9px;font-weight:900;letter-spacing:.32em;color:#8a473f}
.ar-wall-title{margin:4px 0 0;font-family:var(--ar-font-display);font-size:24px;line-height:1;font-weight:700;letter-spacing:.05em;color:#211a14}
.ar-wall-sub{margin:7px 0 0;font-size:11px;line-height:1.5;color:#6d5843}
.ar-wall-count{flex:none;min-width:48px;text-align:right;font-family:var(--ar-font-display);font-size:32px;line-height:.9;font-weight:700;color:#a83a4e}
.ar-wall-count span{display:block;margin-top:5px;font-family:var(--ar-font-ui);font-size:8px;font-weight:900;letter-spacing:.24em;color:#72593d}
.ar-wall-actions{position:relative;z-index:1;display:flex;gap:8px;margin-top:13px}
.ar-wall-act{height:30px;border-radius:999px;border:1px solid rgba(201,163,106,.72);background:transparent;padding:0 12px;font-size:10.5px;font-weight:900;color:#3b2a18;cursor:pointer;transition:background .16s,border-color .16s,transform .12s}
.ar-wall-act:hover{border-color:rgba(168,58,78,.52);background:rgba(201,163,106,.12)}
.ar-wall-act:active{transform:scale(.97);background:rgba(201,163,106,.24)}
.ar-wall-list{display:flex;flex-direction:column;gap:10px;margin:18px 16px 34px}
.ar-wall-card{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;width:100%;min-height:92px;border:0;border-radius:8px;padding:14px 13px;text-align:left;cursor:pointer;overflow:hidden;background:linear-gradient(145deg,#f5efe2,#efe7d6);box-shadow:0 18px 40px -28px rgba(0,0,0,.8),inset 0 0 0 1px rgba(255,255,255,.48);transition:transform .16s,box-shadow .16s}
.ar-wall-card:hover{transform:translateY(-2px);box-shadow:0 24px 48px -30px rgba(0,0,0,.85),inset 0 0 0 1px rgba(201,163,106,.34)}
.ar-wall-card:active{transform:translateY(0) scale(.99)}
.ar-wall-card h3{position:relative;z-index:1;margin:0;font-family:var(--ar-font-display);font-size:20px;line-height:1.1;color:#231a12;letter-spacing:.04em}
.ar-wall-card p{position:relative;z-index:1;margin:6px 0 0;font-size:11px;font-weight:800;color:#a83a4e;letter-spacing:.12em}
.ar-wall-seen{position:absolute;right:13px;top:12px;width:8px;height:8px;border-radius:999px;background:var(--ar-accent);box-shadow:0 0 0 4px rgba(201,163,106,.16)}
.ar-wall-teasers{position:relative;z-index:1;display:flex;flex-direction:column;gap:5px;margin-top:12px}
.ar-wall-teaser{display:flex;align-items:center;gap:7px;min-width:0;color:#5f503f;font-size:11px;font-weight:700}
.ar-wall-teaser i{flex:none;width:28px;height:18px;border-radius:2px;background:linear-gradient(145deg,#ddcfb4,#f7f0e2);box-shadow:inset 0 0 0 1px rgba(63,48,31,.12)}
.ar-wall-teaser span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ar-wall-card-count{position:relative;z-index:1;align-self:end;text-align:right;font-family:var(--ar-font-display);font-size:34px;line-height:.85;color:#a83a4e}
.ar-wall-card-count small{display:block;margin-top:5px;font-family:var(--ar-font-ui);font-size:8px;font-weight:900;letter-spacing:.24em;color:#72593d}
.ar-wall-back{display:inline-flex;align-items:center;gap:6px;height:28px;margin:0 0 10px;border:0;background:transparent;color:#6d5843;font-size:11px;font-weight:900;letter-spacing:.08em;cursor:pointer}
.ar-wall-chips{position:relative;z-index:1;display:flex;gap:7px;overflow-x:auto;margin:13px -2px 0;padding:0 2px 3px;scrollbar-width:none}
.ar-wall-chips::-webkit-scrollbar{display:none}
.ar-wchip{flex:none;max-width:96px;height:25px;border:1px solid rgba(63,48,31,.16);border-radius:999px;background:rgba(255,255,255,.32);padding:0 10px;font-size:10.5px;font-weight:800;color:#5e513f;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ar-wchip.on{border-color:rgba(168,58,78,.44);background:#2d2117;color:#f8ead6}
.ar-wall-grid{position:relative;z-index:1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:13px}
.ar-frag{position:relative;min-height:152px;border:0;border-radius:4px;background:#fffaf1;color:#211f1b;text-align:left;overflow:hidden;cursor:pointer;box-shadow:0 13px 24px -20px rgba(30,25,20,.8),inset 0 0 0 1px rgba(50,45,38,.1);transform:rotate(var(--rot,0deg));transition:transform .18s ease,box-shadow .18s ease}
.ar-frag:hover{transform:rotate(var(--rot,0deg)) translateY(-3px);box-shadow:0 18px 30px -22px rgba(30,25,20,.9),inset 0 0 0 1px rgba(50,45,38,.12)}
.ar-frag:active{transform:rotate(var(--rot,0deg)) translateY(-1px) scale(.985)}
.ar-frag.pull{transform:rotate(var(--rot,0deg)) translateY(-12px)}
.ar-frag-cover{display:block;position:absolute;inset:0;background:linear-gradient(155deg,#f5efe2,#fff8ec 42%,#efe7d6);opacity:.98}
.ar-frag-rule{position:absolute;left:11px;right:11px;top:13px;height:1px;background:rgba(45,42,37,.28)}
.ar-frag-no{position:absolute;right:10px;top:18px;font-size:9px;font-weight:900;letter-spacing:.16em;color:rgba(35,32,28,.45)}
.ar-frag-body{position:relative;z-index:1;display:flex;min-height:152px;flex-direction:column;padding:29px 11px 11px}
.ar-frag-placeholder{margin:0;max-width:78%;font-family:var(--ar-font-display);font-size:18px;line-height:1.08;font-weight:700;color:#231f1c;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ar-frag-preview{position:relative;z-index:1;margin:20px -1px 9px;border-radius:3px;overflow:hidden;background:#efe7d6;box-shadow:inset 0 0 0 1px rgba(45,42,37,.12)}
.ar-frag-preview iframe{pointer-events:none}
.ar-frag-preview-empty{position:relative;z-index:1;margin:31px 0 0;font-family:var(--ar-font-display);font-size:17px;font-weight:700;color:#231f1c;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ar-frag-foot{margin-top:auto;display:flex;align-items:center;justify-content:space-between;gap:8px;border-top:1px solid rgba(45,42,37,.12);padding-top:8px;font-size:8.5px;font-weight:900;letter-spacing:.18em;color:#8a473f}
.ar-frag-foot span:last-child{max-width:8em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right}
.ar-frag-tape{position:absolute;left:14px;top:-5px;width:42px;height:15px;background:rgba(255,255,255,.5);box-shadow:0 1px 3px rgba(30,25,20,.12);transform:rotate(-5deg)}
.ar-imgfrag{position:relative;min-height:152px;border:0;border-radius:3px;background:#f8f2e7;padding:8px 8px 31px;color:#211f1b;text-align:left;overflow:hidden;cursor:pointer;box-shadow:0 15px 27px -21px rgba(30,25,20,.86),inset 0 0 0 1px rgba(50,45,38,.1);transform:rotate(var(--rot,0deg));transition:transform .18s ease,box-shadow .18s ease}
.ar-imgfrag:hover{transform:rotate(var(--rot,0deg)) translateY(-3px);box-shadow:0 20px 32px -22px rgba(30,25,20,.92),inset 0 0 0 1px rgba(50,45,38,.12)}
.ar-imgfrag:active{transform:rotate(var(--rot,0deg)) translateY(-1px) scale(.985)}
.ar-imgfrag::before{content:'';position:absolute;left:14px;top:-6px;width:46px;height:16px;background:rgba(255,255,255,.55);box-shadow:0 1px 4px rgba(30,25,20,.13);transform:rotate(-4deg);z-index:2}
.ar-imgfrag-media{display:block;position:relative;width:100%;height:108px;overflow:hidden;background:linear-gradient(135deg,#ddd2c0,#f7efe1);box-shadow:inset 0 0 0 1px rgba(50,45,38,.12)}
.ar-imgfrag-media img{display:block;width:100%;height:100%;object-fit:cover}
.ar-imgfrag-media::after{content:'';position:absolute;inset:0;pointer-events:none;background:linear-gradient(140deg,rgba(255,255,255,.22),transparent 36%),radial-gradient(circle at 12% 18%,rgba(255,255,255,.26),transparent 30%);mix-blend-mode:screen}
.ar-imgfrag-name{position:absolute;left:10px;right:10px;bottom:13px;font-family:var(--ar-font-display);font-size:13px;font-weight:700;line-height:1.15;color:#2d2925;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ar-imgfrag-tag{position:absolute;right:9px;top:100px;border:1px solid rgba(45,42,37,.16);background:rgba(248,242,231,.88);padding:2px 6px;font-size:7.5px;font-weight:900;letter-spacing:.16em;color:#8a473f}
.ar-textfrag{position:relative;min-height:142px;border:0;border-radius:5px;background:#fff1a8;color:#2d2925;text-align:left;overflow:hidden;cursor:default;padding:23px 13px 12px;box-shadow:0 14px 24px -21px rgba(30,25,20,.82),inset 0 0 0 1px rgba(107,89,34,.14);transform:rotate(var(--rot,0deg))}
.ar-textfrag.char{background:#fff5be;transform:rotate(-2deg);animation:ar-note-in .28s cubic-bezier(.2,.9,.3,1)}
.ar-textfrag::before{content:'';position:absolute;left:0;right:0;top:0;height:18px;background:linear-gradient(180deg,rgba(255,255,255,.32),rgba(255,255,255,0))}
.ar-textfrag-dot{position:absolute;left:12px;top:9px;min-width:18px;height:18px;border-radius:999px;border:1px solid #a83a4e;background:rgba(255,245,190,.62);display:flex;align-items:center;justify-content:center;padding:0 3px;font-size:10px;font-family:var(--ar-font-display);font-weight:800;color:#a83a4e;box-shadow:0 0 0 3px rgba(168,58,78,.08)}
.ar-textfrag-body{display:block;font-family:'Kaiti SC',STKaiti,'楷体',serif;font-size:15px;line-height:1.55;color:#3f3528;white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}
.ar-textfrag-foot{position:absolute;left:13px;right:13px;bottom:10px;border-top:1px solid rgba(63,53,40,.12);padding-top:6px;font-size:8px;font-weight:900;letter-spacing:.18em;color:#8a6b26}
.ar-frag-empty{position:relative;z-index:1;margin-top:12px;border:1px dashed rgba(49,55,51,.22);border-radius:8px;padding:18px;text-align:center;color:#6d6157;font-size:12px;line-height:1.8;background:rgba(255,255,255,.25)}
.ar-freader{position:relative;width:min(94vw,560px);max-height:calc(100dvh - 42px);display:flex;flex-direction:column;align-items:center;gap:13px}
.ar-freader-card{width:100%;max-height:calc(100dvh - 142px);display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:14px;background:rgba(11,10,9,.34);box-shadow:0 24px 60px -24px rgba(0,0,0,.82),inset 0 0 0 1px rgba(255,236,210,.1);padding:14px}
.ar-freader-meta{width:100%;display:flex;align-items:flex-end;justify-content:space-between;gap:12px;color:var(--ar-t1)}
.ar-freader-meta b{display:block;font-family:var(--ar-font-display);font-size:18px;line-height:1.2}
.ar-freader-meta small{display:block;margin-top:4px;font-size:10px;letter-spacing:.14em;color:var(--ar-t3)}
.ar-imgreader{position:relative;width:min(94vw,640px);max-height:calc(100dvh - 42px);display:flex;flex-direction:column;gap:13px}
.ar-imgreader-frame{overflow:hidden;border-radius:16px;background:#090807;box-shadow:0 24px 60px -24px rgba(0,0,0,.82),inset 0 0 0 1px rgba(255,236,210,.1)}
.ar-imgreader-frame img{display:block;width:100%;max-height:calc(100dvh - 188px);object-fit:contain}
.ar-imgreader-prompt{margin:0;border-radius:13px;border:1px solid rgba(255,236,210,.1);background:rgba(12,10,8,.76);padding:11px 12px;font-size:12px;line-height:1.65;color:var(--ar-t2);white-space:pre-wrap}
.ar-editor{width:min(96vw,720px);max-height:calc(100dvh - 38px);display:flex;flex-direction:column;border-radius:22px;overflow:hidden;background:#17120e;color:var(--ar-t1);box-shadow:0 28px 80px -28px rgba(0,0,0,.9),inset 0 0 0 1px rgba(255,236,210,.08)}
.ar-editor-hd{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;border-bottom:1px solid var(--ar-line);padding:17px 18px 13px;background:linear-gradient(180deg,#241b14,#17120e)}
.ar-editor-hd h3{margin:0;font-family:var(--ar-font-display);font-size:22px;letter-spacing:.06em}
.ar-editor-hd p{margin:4px 0 0;font-size:11px;color:var(--ar-t3);letter-spacing:.08em}
.ar-editor-body{overflow-y:auto;padding:15px 16px 16px}
.ar-editor-section{margin-top:24px}
.ar-editor-section:first-child{margin-top:0}
.ar-editor-sec-title{margin:0 0 12px;font-size:9px;font-weight:900;letter-spacing:.28em;color:var(--ar-accent)}
.ar-editor-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.ar-field{display:flex;flex-direction:column;gap:6px}
.ar-field span{font-size:10px;font-weight:900;letter-spacing:.2em;color:var(--ar-t3)}
.ar-field input,.ar-field textarea,.ar-field select{border:1px solid var(--ar-line);border-radius:12px;background:#100c09;color:var(--ar-t1);font:inherit;font-size:13px;outline:none;padding:10px 11px}
.ar-field input[type=range]{accent-color:var(--ar-accent)}
.ar-field textarea{min-height:40px;resize:none;transition:min-height .18s}
.ar-note-compose{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:9px;align-items:start}
.ar-note-input:focus{min-height:86px}
.ar-note-compose button{height:40px;border-radius:999px;border:1px solid rgba(201,163,106,.55);background:transparent;color:var(--ar-accent);padding:0 13px;font-size:12px;font-weight:900;cursor:pointer}
.ar-editor-row{display:flex;flex-wrap:wrap;align-items:center;gap:9px;margin-top:12px}
.ar-editor-chip{display:flex;align-items:center;gap:7px;border:1px solid var(--ar-line);border-radius:999px;background:#100c09;padding:8px 11px;font-size:12px;color:var(--ar-t2)}
.ar-editor-chip input{accent-color:#c9a36a}
.ar-swatch-row{display:flex;gap:8px;overflow-x:auto;padding-bottom:2px;scrollbar-width:none}
.ar-swatch-row::-webkit-scrollbar{display:none}
.ar-swatch{flex:none;width:34px;height:34px;border-radius:999px;border:1px solid rgba(255,236,210,.14);background:var(--sw);box-shadow:inset 0 0 0 2px rgba(0,0,0,.16);cursor:pointer}
.ar-swatch.on{border-color:var(--ar-accent);box-shadow:0 0 0 2px rgba(201,163,106,.22),inset 0 0 0 2px rgba(0,0,0,.16)}
.ar-editor-list{display:flex;flex-direction:column;gap:8px;margin-top:14px}
.ar-editor-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;border:1px solid var(--ar-line);border-radius:14px;background:rgba(255,236,210,.035);padding:10px 10px 10px 12px}
.ar-editor-item b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:var(--ar-t1)}
.ar-editor-item small{display:block;margin-top:3px;font-size:10px;color:var(--ar-t3);letter-spacing:.08em}
.ar-editor-mini{display:flex;gap:6px}
.ar-editor-mini button,.ar-editor-tools button{border:1px solid var(--ar-line);border-radius:999px;background:#100c09;color:var(--ar-t2);height:29px;padding:0 10px;font-size:11px;font-weight:800;cursor:pointer}
.ar-editor-mini button{display:flex;align-items:center;justify-content:center;width:44px;height:44px;padding:0}
.ar-editor-mini button:hover,.ar-editor-tools button:hover{color:var(--ar-t1);border-color:rgba(201,163,106,.35)}
.ar-editor-tools{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.ar-editor-ft{display:flex;gap:9px;border-top:1px solid var(--ar-line);padding:12px 16px calc(env(safe-area-inset-bottom,0px) + 12px);background:#120e0a}
.ar-editor-ft button{flex:1;height:40px;border-radius:999px;border:1px solid var(--ar-line);background:transparent;color:var(--ar-t2);font-size:13px;font-weight:800;cursor:pointer}
.ar-editor-ft button.primary{border:0;background:linear-gradient(180deg,#d2ab6e,#a87f43);color:#241704}

/* ---------- 阅读器 · 小电子书 ---------- */
.ar-veil{position:fixed;inset:0;z-index:100;display:flex;justify-content:center;background:rgba(8,5,3,.66);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);animation:ar-fade .2s ease}
.ar-veil.book{align-items:center;padding:20px 16px}
.ar-veil.bottom{align-items:flex-end;padding:0 10px}
.ar-veil.center{align-items:center;padding:26px}
.ar-veil.over{z-index:130}
@keyframes ar-fade{from{opacity:0}}
@keyframes ar-rise{from{transform:translateY(30px);opacity:0}}
@keyframes ar-bookin{from{opacity:0;transform:perspective(900px) rotateY(-14deg) translateY(22px)}}
@keyframes ar-note-in{from{opacity:0;transform:rotate(-2deg) translateY(12px) scale(.96)}}
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

function useWidth<T extends HTMLElement>(ref: React.RefObject<T | null>, fallback = 372) {
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

const getFreeformShape = (book: CollectionBook): string =>
    String(
        book.cardData?.meta?.freeformShape
        || book.meta?.shape
        || book.cardData?.meta?.shape
        || getCollectionDisplayTitle(book)
        || '视觉碎片',
    ).trim();

const truncateUiLabel = (value: string, max = 8): string => {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
};

const WALL_PREVIEW_WIDTH = 375;
const WALL_PREVIEW_LIMIT = 12;
const WALL_PREVIEW_SLOT_EVENT = 'collection-wall-preview-slots';
const wallPreviewMountedIds = new Set<string>();

type WallBookEntry = {
    id: string;
    type: 'book';
    item?: CollectionWallItem;
    book: CollectionBook;
};

type WallImageEntry = {
    id: string;
    type: 'image';
    item: CollectionWallItem;
    asset: CollectionWallAsset;
};

type WallTextEntry = {
    id: string;
    type: 'text';
    item: CollectionWallItem;
};

type WallZoneEntry = WallBookEntry | WallImageEntry | WallTextEntry;

const getAssetLabel = (asset: CollectionWallAsset, item?: CollectionWallItem): string => {
    const fromItem = String(item?.name || '').trim();
    const fromMeta = String(asset.meta?.name || '').trim();
    const fromPrompt = String(asset.meta?.prompt || '').trim();
    return (fromItem || fromMeta || fromPrompt || '聊天生成图').slice(0, 40);
};

const getTextLabel = (item: CollectionWallItem): string =>
    String(item.text?.content || item.name || '一张便签').trim().slice(0, 60);

function useWallPreviewMountSlot(id: string, ref: React.RefObject<HTMLElement | null>): boolean {
    const [inRange, setInRange] = useState(false);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el || typeof IntersectionObserver === 'undefined') {
            setInRange(true);
            return undefined;
        }
        const observer = new IntersectionObserver(
            ([entry]) => setInRange(Boolean(entry?.isIntersecting)),
            { rootMargin: '600px 0px' },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [ref]);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        let disposed = false;

        const release = () => {
            if (wallPreviewMountedIds.delete(id)) {
                window.dispatchEvent(new Event(WALL_PREVIEW_SLOT_EVENT));
            }
            setMounted(false);
        };

        const tryAcquire = () => {
            if (disposed || !inRange) return;
            if (wallPreviewMountedIds.has(id) || wallPreviewMountedIds.size < WALL_PREVIEW_LIMIT) {
                wallPreviewMountedIds.add(id);
                setMounted(true);
            }
        };

        if (!inRange) {
            release();
            return undefined;
        }

        tryAcquire();
        window.addEventListener(WALL_PREVIEW_SLOT_EVENT, tryAcquire);
        return () => {
            disposed = true;
            window.removeEventListener(WALL_PREVIEW_SLOT_EVENT, tryAcquire);
            release();
        };
    }, [id, inRange]);

    return mounted;
}

const WallHtmlPreview: React.FC<{
    book: CollectionBook;
    hostRef: React.RefObject<HTMLElement | null>;
    width: number;
}> = ({ book, hostRef, width }) => {
    const html = String(book.cardData?.meta?.html || '');
    const frameRef = useRef<HTMLIFrameElement>(null);
    const frameChannel = React.useId().replace(/:/g, '_');
    const shouldMount = useWallPreviewMountSlot(book.id, hostRef);
    const [ready, setReady] = useState(false);
    const [hasMeasured, setHasMeasured] = useState(false);
    const [frameHeight, setFrameHeight] = useState(220);

    useEffect(() => {
        if (!shouldMount) {
            setReady(false);
            setHasMeasured(false);
            setFrameHeight(220);
        }
    }, [shouldMount]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent<{ type?: string; channel?: string; height?: number }>) => {
            if (event.source !== frameRef.current?.contentWindow) return;
            if (event.data?.type !== 'preview-height') return;
            if (event.data.channel !== frameChannel) return;
            const nextHeight = typeof event.data.height === 'number'
                ? Math.max(160, event.data.height + STATUS_CARD_MEASURE_BUFFER_PX)
                : 220;
            setFrameHeight(nextHeight);
            setHasMeasured(true);
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [frameChannel]);

    useEffect(() => {
        if (!shouldMount || !ready || !html) return;
        frameRef.current?.contentWindow?.postMessage(
            {
                type: 'preview-update',
                channel: frameChannel,
                html,
                allowScripts: book.cardData?.meta?.allowScripts === true,
                stageWidth: WALL_PREVIEW_WIDTH,
            },
            '*',
        );
    }, [book.cardData?.meta?.allowScripts, frameChannel, html, ready, shouldMount]);

    if (!html || !shouldMount) return null;

    const scale = Math.max(0.2, width / WALL_PREVIEW_WIDTH);
    const fittedHeight = Math.ceil(frameHeight * scale);

    return (
        <span className="ar-frag-preview" style={{ height: fittedHeight || 120, opacity: hasMeasured ? 1 : 0, transition: 'opacity 200ms ease' }}>
            <iframe
                ref={frameRef}
                srcDoc={STATUS_CARD_IFRAME_SHELL}
                sandbox="allow-scripts"
                title="Freeform creative card"
                style={{
                    width: WALL_PREVIEW_WIDTH,
                    height: frameHeight,
                    border: 'none',
                    borderRadius: 0,
                    background: 'transparent',
                    colorScheme: 'light dark',
                    overflow: 'hidden',
                    display: 'block',
                    transform: `scale(${scale})`,
                    transformOrigin: 'top left',
                    pointerEvents: 'none',
                }}
                onLoad={() => setReady(true)}
            />
        </span>
    );
};

const useAssetObjectUrl = (asset: CollectionWallAsset | null): string => {
    const [url, setUrl] = useState('');

    useEffect(() => {
        if (!asset?.blob) {
            setUrl('');
            return;
        }
        const nextUrl = URL.createObjectURL(asset.blob);
        setUrl(nextUrl);
        return () => URL.revokeObjectURL(nextUrl);
    }, [asset]);

    return url;
};

const FreeformFragment: React.FC<{ book: CollectionBook; index: number; pulling: boolean; onPick: (book: CollectionBook) => void }> = ({ book, index, pulling, onPick }) => {
    const title = getCollectionDisplayTitle(book);
    const shape = getFreeformShape(book);
    const summary = getFreeformSummary(book);
    const palette = FRAGMENT_PALETTES[hashOf(book.id + title) % FRAGMENT_PALETTES.length];
    const rot = ((hashOf(book.id) % 7) - 3) * 0.45;
    return (
        <button
            type="button"
            className={`ar-frag${pulling ? ' pull' : ''}`}
            style={{
                '--rot': `${rot}deg`,
                '--frag-a': palette[0],
                '--frag-b': palette[1],
            } as React.CSSProperties}
            title={title}
            aria-label={`打开视觉碎片《${title}》`}
            onClick={() => onPick(book)}
        >
            <span className="ar-frag-cover" />
            <span className="ar-frag-tape" />
            <span className="ar-frag-rule" />
            <span className="ar-frag-no">NO.{String(index + 1).padStart(2, '0')}</span>
            <span className="ar-frag-body">
                <span className="ar-frag-shape">{shape}</span>
                <span className="ar-frag-summary">{summary || '一枚尚未命名的生活碎片。'}</span>
                <span className="ar-frag-foot">
                    <span>{fmtDate(book.collectedAt).slice(5)}</span>
                    <span>LIGHT WALL</span>
                </span>
            </span>
            <span className="ar-frag-pin" />
        </button>
    );
};

const ImageFragment: React.FC<{ entry: WallImageEntry; index: number; onPick: (entry: WallImageEntry) => void }> = ({ entry, index, onPick }) => {
    const url = useAssetObjectUrl(entry.asset);
    const label = getAssetLabel(entry.asset, entry.item);
    const rot = ((hashOf(entry.id) % 7) - 3) * 0.5;
    return (
        <button
            type="button"
            className="ar-imgfrag"
            style={{ '--rot': `${rot}deg` } as React.CSSProperties}
            title={label}
            aria-label={`打开图片《${label}》`}
            onClick={() => onPick(entry)}
        >
            <span className="ar-imgfrag-media">
                {url && <img src={url} alt="" loading="lazy" />}
            </span>
            <span className="ar-imgfrag-tag">IMG {String(index + 1).padStart(2, '0')}</span>
            <span className="ar-imgfrag-name">{label}</span>
        </button>
    );
};

const TextFragment: React.FC<{ entry: WallTextEntry }> = ({ entry }) => {
    const rot = ((hashOf(entry.id) % 7) - 3) * 0.48;
    const label = getTextLabel(entry.item);
    return (
        <article
            className={`ar-textfrag${entry.item.author === 'char' ? ' char' : ''}`}
            style={{ '--rot': `${rot}deg` } as React.CSSProperties}
            aria-label={label}
        >
            <span className="ar-textfrag-dot" />
            <span className="ar-textfrag-body">{label}</span>
            <span className="ar-textfrag-foot">{entry.item.author === 'char' ? 'CHAR NOTE' : 'NOTE'}</span>
        </article>
    );
};

const LightWallZone: React.FC<{
    wall: CollectionWall;
    entries: WallZoneEntry[];
    pullingId: string | null;
    onPickBook: (book: CollectionBook) => void;
    onPickImage: (entry: WallImageEntry) => void;
    onEditWall?: (wall: CollectionWall, entries: WallZoneEntry[]) => void;
    onInviteChar?: (wall: CollectionWall, entries: WallZoneEntry[]) => void;
}> = ({ wall, entries, pullingId, onPickBook, onPickImage, onEditWall, onInviteChar }) => {
    const [shapeFilter, setShapeFilter] = useState('');
    const books = useMemo(() => entries
        .filter((entry): entry is WallBookEntry => entry.type === 'book')
        .map(entry => entry.book), [entries]);
    const shapes = useMemo(() => (
        Array.from(new Set(books.map(getFreeformShape).filter(Boolean))).slice(0, 10)
    ), [books]);
    const visibleEntries = shapeFilter
        ? entries.filter(entry => entry.type === 'book' && getFreeformShape(entry.book) === shapeFilter)
        : entries;

    useEffect(() => {
        if (shapeFilter && !shapes.includes(shapeFilter)) setShapeFilter('');
    }, [shapeFilter, shapes]);

    return (
        <section className="ar-wall">
            <div className="ar-wall-top">
                <div>
                    <p className="ar-wall-kicker">VISUAL FRAGMENTS</p>
                    <h3 className="ar-wall-title">{wall.name}{wall.hasUnseenCharItem ? ' · TA 来过' : ''}</h3>
                    <p className="ar-wall-sub">自由创作收进这里，像一组生活边角的私印杂志。</p>
                </div>
                <div className="ar-wall-count">{entries.length}<span>PIECES</span></div>
            </div>
            {onEditWall && !wall.id.startsWith('fallback-') && (
                <div className="ar-wall-actions">
                    <button type="button" className="ar-wall-act" onClick={() => onEditWall(wall, entries)}>装修</button>
                    {onInviteChar && wall.allowCharDecorate && (
                        <button type="button" className="ar-wall-act" onClick={() => onInviteChar(wall, entries)}>邀请 TA</button>
                    )}
                </div>
            )}
            {shapes.length > 1 && (
                <div className="ar-wall-chips" aria-label="按形态筛选视觉碎片">
                    <button type="button" className={`ar-wchip${!shapeFilter ? ' on' : ''}`} onClick={() => setShapeFilter('')}>全部</button>
                    {shapes.map(shape => (
                        <button
                            type="button"
                            key={shape}
                            className={`ar-wchip${shapeFilter === shape ? ' on' : ''}`}
                            onClick={() => setShapeFilter(shape)}
                        >
                            {shape}
                        </button>
                    ))}
                </div>
            )}
            {visibleEntries.length > 0 ? (
                <div className="ar-wall-grid">
                    {visibleEntries.map((entry, index) => {
                        if (entry.type === 'image') {
                            return <ImageFragment key={entry.id} entry={entry} index={index} onPick={onPickImage} />;
                        }
                        if (entry.type === 'text') {
                            return <TextFragment key={entry.id} entry={entry} />;
                        }
                        return (
                            <FreeformFragment
                                key={entry.id}
                                book={entry.book}
                                index={index}
                                pulling={pullingId === entry.book.id}
                                onPick={onPickBook}
                            />
                        );
                    })}
                </div>
            ) : (
                <div className="ar-frag-empty">这个形态下暂时还没有碎片。</div>
            )}
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

const FreeformReader: React.FC<{
    book: CollectionBook;
    char: { name: string } | undefined;
    onClose: () => void;
    onEdit: () => void;
    onForward: () => void;
    onDelete: () => void;
}> = ({ book, char, onClose, onEdit, onForward, onDelete }) => {
    const title = getCollectionDisplayTitle(book);
    return (
        <div className="ar-veil book" onClick={onClose}>
            <div className="ar-freader" onClick={(e) => e.stopPropagation()}>
                <div className="ar-freader-meta">
                    <span>
                        <b>{title}</b>
                        <small>{formatCollectionKindLabel(book.kind)} · {char?.name || '已删除角色'} · {fmtDate(book.collectedAt)}</small>
                    </span>
                    <button type="button" className="ar-ebk-x" aria-label="合上" onClick={onClose}><X weight="bold" /></button>
                </div>
                <div className="ar-freader-card">
                    <React.Suspense fallback={<div style={{ color: '#e9dcc6', padding: 40 }}>正在展开碎片...</div>}>
                        <StatusCardRenderer data={book.cardData} />
                    </React.Suspense>
                </div>
                <div className="ar-ebk-acts">
                    <button type="button" className="ar-ract" onClick={onEdit}><PencilSimple weight="bold" />改标签</button>
                    <button type="button" className="ar-ract danger" onClick={onDelete}><Trash weight="bold" />删除</button>
                    <button type="button" className="ar-ract" onClick={onForward}><PaperPlaneTilt weight="bold" />转递</button>
                </div>
            </div>
        </div>
    );
};

const WallImageReader: React.FC<{
    entry: WallImageEntry;
    wallName: string;
    onClose: () => void;
}> = ({ entry, wallName, onClose }) => {
    const url = useAssetObjectUrl(entry.asset);
    const label = getAssetLabel(entry.asset, entry.item);
    const prompt = String(entry.asset.meta?.prompt || '').trim();
    return (
        <div className="ar-veil book" onClick={onClose}>
            <div className="ar-imgreader" onClick={(e) => e.stopPropagation()}>
                <div className="ar-freader-meta">
                    <span>
                        <b>{label}</b>
                        <small>图片素材 · {wallName} · {fmtDate(entry.asset.createdAt || entry.item.createdAt)}</small>
                    </span>
                    <button type="button" className="ar-ebk-x" aria-label="合上" onClick={onClose}><X weight="bold" /></button>
                </div>
                <div className="ar-imgreader-frame">
                    {url && <img src={url} alt={label} />}
                </div>
                {prompt && <p className="ar-imgreader-prompt">{prompt}</p>}
            </div>
        </div>
    );
};

const createLocalItemId = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `wallitem-${crypto.randomUUID()}`;
    }
    return `wallitem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const relabelItems = (items: CollectionWallItem[]): CollectionWallItem[] =>
    items.map((item, index) => ({ ...item, order: index, z: item.z || index + 1 }));

const autoArrangeWallItems = (items: CollectionWallItem[]): CollectionWallItem[] => {
    const gutter = 18;
    const colW = (750 - 32 - gutter) / 2;
    const colX = [16, 16 + colW + gutter];
    const colY = [24, 24];
    return relabelItems(items).map((item, index) => {
        const col = colY[0] <= colY[1] ? 0 : 1;
        const baseW = item.type === 'card' ? 375 : item.type === 'image' ? 320 : 220;
        const baseH = item.type === 'card' ? 220 : item.type === 'image' ? 240 : 150;
        const scale = colW / baseW;
        const h = Math.round(baseH * scale);
        const next = {
            ...item,
            x: Math.round(colX[col]),
            y: Math.round(colY[col]),
            w: Math.round(colW),
            h,
            rotation: ((hashOf(item.id + index) % 7) - 3) * 0.35,
            z: index + 1,
        };
        colY[col] += h + gutter;
        return next;
    });
};

const getEditorItemLabel = (item: CollectionWallItem, entryByItemId: Map<string, WallZoneEntry>): string => {
    const entry = entryByItemId.get(item.id);
    if (entry?.type === 'book') return getCollectionDisplayTitle(entry.book);
    if (entry?.type === 'image') return getAssetLabel(entry.asset, item);
    if (item.type === 'text') return getTextLabel(item);
    return item.name || item.type;
};

const getEditorItemKind = (item: CollectionWallItem): string => {
    if (item.type === 'card') return '视觉碎片';
    if (item.type === 'image') return '图片素材';
    if (item.type === 'text') return item.author === 'char' ? 'TA 的便签' : '文字便签';
    if (item.type === 'html') return '自制 HTML';
    return '贴纸';
};

const getWallEntryLabel = (entry: WallZoneEntry): string => {
    if (entry.type === 'book') return getFreeformShape(entry.book) || getCollectionDisplayTitle(entry.book);
    if (entry.type === 'image') return getAssetLabel(entry.asset, entry.item);
    return getTextLabel(entry.item);
};

const WallEditor: React.FC<{
    wall: CollectionWall;
    entries: WallZoneEntry[];
    onClose: () => void;
    onSaved: () => void;
    onDirtyChange?: (dirty: boolean) => void;
    say: (message: string) => void;
}> = ({ wall, entries, onClose, onSaved, onDirtyChange, say }) => {
    const [draftWall, setDraftWall] = useState<CollectionWall>(wall);
    const [draftItems, setDraftItems] = useState<CollectionWallItem[]>(() => relabelItems(entries.map(entry => entry.item).filter((item): item is CollectionWallItem => Boolean(item))));
    const [textDraft, setTextDraft] = useState('');
    const [selectedId, setSelectedId] = useState('');
    const [saving, setSaving] = useState(false);
    const entryByItemId = useMemo(() => new Map(entries.filter(entry => Boolean(entry.item)).map(entry => [entry.item!.id, entry])), [entries]);
    const selectedItem = draftItems.find(item => item.id === selectedId) || null;
    const initialDraftSnapshotRef = useRef('');
    if (!initialDraftSnapshotRef.current) {
        initialDraftSnapshotRef.current = serializeWallEditorDraft(wall, draftItems, '');
    }
    const hasUnsavedChanges = hasWallEditorDraftChanges(initialDraftSnapshotRef.current, draftWall, draftItems, textDraft);

    useEffect(() => {
        onDirtyChange?.(hasUnsavedChanges);
        return () => onDirtyChange?.(false);
    }, [hasUnsavedChanges, onDirtyChange]);

    useEffect(() => {
        if (!hasUnsavedChanges) return undefined;
        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = '未保存更改';
            return '未保存更改';
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [hasUnsavedChanges]);

    useEffect(() => {
        if (!hasUnsavedChanges) return undefined;
        const state = { ...(window.history.state || {}), collectionWallEditorGuard: true };
        window.history.pushState(state, '', window.location.href);
        const handlePopState = () => {
            if (window.confirm('未保存更改')) {
                onClose();
                return;
            }
            window.history.pushState(state, '', window.location.href);
        };
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [hasUnsavedChanges, onClose]);

    const requestClose = useCallback(() => {
        if (saving) return;
        if (!hasUnsavedChanges || window.confirm('未保存更改')) {
            onClose();
        }
    }, [hasUnsavedChanges, onClose, saving]);

    const updateWall = (patch: Partial<CollectionWall>) => {
        setDraftWall(prev => ({ ...prev, ...patch }));
    };

    const patchItem = (id: string, patch: Partial<CollectionWallItem>) => {
        setDraftItems(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item));
    };

    const moveItem = (id: string, delta: number) => {
        setDraftItems(prev => {
            const next = [...prev];
            const index = next.findIndex(item => item.id === id);
            const target = index + delta;
            if (index < 0 || target < 0 || target >= next.length) return prev;
            const [item] = next.splice(index, 1);
            next.splice(target, 0, item);
            return relabelItems(next);
        });
    };

    const addTextItem = () => {
        const content = textDraft.trim();
        if (!content) {
            say('先写一点便签内容');
            return;
        }
        const now = Date.now();
        setDraftItems(prev => relabelItems([
            ...prev,
            {
                id: createLocalItemId(),
                wallId: wall.id,
                type: 'text',
                author: 'user',
                x: draftWall.layoutMode === 'free' ? null : null,
                y: null,
                w: 220,
                h: 150,
                rotation: 0,
                z: prev.length + 1,
                order: prev.length,
                text: { content: content.slice(0, 120), preset: 'sticky_note' },
                name: '文字便签',
                createdAt: now,
            },
        ]));
        setTextDraft('');
    };

    const deleteItem = (id: string) => {
        setDraftItems(prev => relabelItems(prev.filter(item => item.id !== id)));
        if (selectedId === id) setSelectedId('');
    };

    const arrange = () => {
        setDraftWall(prev => ({ ...prev, layoutMode: 'free' }));
        setDraftItems(prev => autoArrangeWallItems(prev));
    };

    const adjustSelected = (patch: Partial<CollectionWallItem>) => {
        if (!selectedItem) return;
        patchItem(selectedItem.id, patch);
    };

    const handleSave = async () => {
        if (saving) return;
        const name = draftWall.name.replace(/\s+/g, ' ').trim().slice(0, 12);
        if (!name) {
            say('先给墙留个名字');
            return;
        }
        setSaving(true);
        try {
            const originalItemIds = new Set(entries.map(entry => entry.item?.id).filter((id): id is string => Boolean(id)));
            const draftItemIds = new Set(draftItems.map(item => item.id));
            const deletedIds = Array.from(originalItemIds).filter(id => !draftItemIds.has(id));
            await DB.saveCollectionWall({
                ...draftWall,
                name,
                background: {
                    ...draftWall.background,
                    dim: clamp(Number(draftWall.background.dim) || 0, 0, 0.6),
                },
                changeCountSinceVisit: (draftWall.changeCountSinceVisit || 0) + 1,
            });
            await Promise.all(deletedIds.map(id => DB.deleteCollectionWallItem(id)));
            await Promise.all(relabelItems(draftItems).map(item => DB.saveCollectionWallItem({ ...item, wallId: wall.id })));
            addCollectionWallPendingContext(wall.charId, `用户最近在「${name}」整理了拾光墙，墙上现在有 ${draftItems.length} 件内容。下次对话可自然提及，不要刻意。`);
            initialDraftSnapshotRef.current = serializeWallEditorDraft(draftWall, draftItems, textDraft);
            say('拾光墙已保存');
            onSaved();
            onClose();
        } catch (error) {
            console.error('[CollectionHall] wall editor save failed:', error);
            say('保存失败，稍后再试');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="ar-veil book over" onClick={requestClose}>
            <div className="ar-editor" onClick={(event) => event.stopPropagation()}>
                <div className="ar-editor-hd">
                    <div>
                        <h3>装修拾光墙</h3>
                        <p>{draftItems.length} 件内容 · {draftWall.layoutMode === 'free' ? '自由画布' : 'Flow 排列'}</p>
                    </div>
                    <button type="button" className="ar-ebk-x" aria-label="关闭" onClick={requestClose}><X weight="bold" /></button>
                </div>
                <div className="ar-editor-body">
                    <div className="ar-editor-grid">
                        <label className="ar-field">
                            <span>墙名</span>
                            <input value={draftWall.name} maxLength={12} onChange={event => updateWall({ name: event.target.value.slice(0, 12) })} />
                        </label>
                        <label className="ar-field">
                            <span>布局</span>
                            <select value={draftWall.layoutMode} onChange={event => updateWall({ layoutMode: event.target.value as CollectionWall['layoutMode'] })}>
                                <option value="flow">flow 排列</option>
                                <option value="free">free 画布</option>
                            </select>
                        </label>
                        <label className="ar-field">
                            <span>背景色</span>
                            <input type="color" value={draftWall.background.value || '#17120e'} onChange={event => updateWall({ background: { ...draftWall.background, type: 'color', value: event.target.value } })} />
                        </label>
                        <label className="ar-field">
                            <span>压暗 {Math.round((draftWall.background.dim || 0) * 100)}%</span>
                            <input type="range" min="0" max="0.6" step="0.05" value={draftWall.background.dim || 0} onChange={event => updateWall({ background: { ...draftWall.background, dim: Number(event.target.value) } })} />
                        </label>
                    </div>
                    <div className="ar-editor-row">
                        <label className="ar-editor-chip">
                            <input type="checkbox" checked={draftWall.allowCharDecorate} onChange={event => updateWall({ allowCharDecorate: event.target.checked })} />
                            允许 TA 布置
                        </label>
                        <button type="button" className="ar-wall-act" onClick={arrange}>一键整理</button>
                    </div>
                    <div className="ar-editor-grid" style={{ marginTop: 13 }}>
                        <label className="ar-field" style={{ gridColumn: '1 / -1' }}>
                            <span>新增文字便签</span>
                            <textarea value={textDraft} maxLength={120} onChange={event => setTextDraft(event.target.value)} placeholder="写一张贴在墙上的小纸条..." />
                        </label>
                    </div>
                    <div className="ar-editor-tools">
                        <button type="button" onClick={addTextItem}>插入便签</button>
                        <button type="button" onClick={() => setDraftItems(prev => relabelItems([...prev].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0))))}>按位置转 flow</button>
                    </div>

                    {draftWall.layoutMode === 'free' ? (
                        <>
                            <div className="ar-editor-canvas" style={{ background: draftWall.background.type === 'color' ? draftWall.background.value : undefined }}>
                                <div style={{ position: 'absolute', inset: 0, background: `rgba(0,0,0,${draftWall.background.dim || 0})`, pointerEvents: 'none' }} />
                                {draftItems.map(item => {
                                    const x = typeof item.x === 'number' ? item.x : 24 + (item.order % 2) * 250;
                                    const y = typeof item.y === 'number' ? item.y : 24 + Math.floor(item.order / 2) * 180;
                                    const w = item.w || 220;
                                    const h = item.h || 150;
                                    return (
                                        <button
                                            type="button"
                                            key={item.id}
                                            className={`ar-editor-freeitem${selectedId === item.id ? ' on' : ''}`}
                                            style={{
                                                left: `${(x / 750) * 100}%`,
                                                top: `${(y / 620) * 100}%`,
                                                width: `${(w / 750) * 100}%`,
                                                height: `${(h / 620) * 100}%`,
                                                '--rot': `${item.rotation || 0}deg`,
                                            } as React.CSSProperties}
                                            onClick={() => setSelectedId(item.id)}
                                        >
                                            {getEditorItemLabel(item, entryByItemId)}
                                        </button>
                                    );
                                })}
                            </div>
                            {selectedItem && (
                                <div className="ar-editor-tools">
                                    <button type="button" onClick={() => adjustSelected({ x: clamp((selectedItem.x ?? 0) - 24, 0, 720) })}>左移</button>
                                    <button type="button" onClick={() => adjustSelected({ x: clamp((selectedItem.x ?? 0) + 24, 0, 720) })}>右移</button>
                                    <button type="button" onClick={() => adjustSelected({ y: clamp((selectedItem.y ?? 0) - 24, 0, 900) })}>上移</button>
                                    <button type="button" onClick={() => adjustSelected({ y: clamp((selectedItem.y ?? 0) + 24, 0, 900) })}>下移</button>
                                    <button type="button" onClick={() => adjustSelected({ rotation: clamp((selectedItem.rotation || 0) - 2, -18, 18) })}>逆旋</button>
                                    <button type="button" onClick={() => adjustSelected({ rotation: clamp((selectedItem.rotation || 0) + 2, -18, 18) })}>顺旋</button>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="ar-editor-list">
                            {draftItems.map((item, index) => (
                                <div key={item.id} className="ar-editor-item">
                                    <span>
                                        <b>{getEditorItemLabel(item, entryByItemId)}</b>
                                        <small>{String(index + 1).padStart(2, '0')} · {getEditorItemKind(item)}</small>
                                    </span>
                                    <span className="ar-editor-mini">
                                        <button type="button" onClick={() => moveItem(item.id, -1)}>上移</button>
                                        <button type="button" onClick={() => moveItem(item.id, 1)}>下移</button>
                                        {item.type !== 'card' && <button type="button" onClick={() => deleteItem(item.id)}>删除</button>}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <div className="ar-editor-ft">
                    <button type="button" onClick={requestClose} disabled={saving}>取消</button>
                    <button type="button" className="primary" onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '完成'}</button>
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
    const [walls, setWalls] = useState<CollectionWall[]>([]);
    const [wallItems, setWallItems] = useState<CollectionWallItem[]>([]);
    const [wallAssets, setWallAssets] = useState<CollectionWallAsset[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(0);
    const [drag, setDrag] = useState(0);
    const [selected, setSelected] = useState<CollectionBook | null>(null);
    const [selectedImage, setSelectedImage] = useState<{ entry: WallImageEntry; wallName: string } | null>(null);
    const [editingWall, setEditingWall] = useState<{ wall: CollectionWall; entries: WallZoneEntry[] } | null>(null);
    const [pullingId, setPullingId] = useState<string | null>(null);
    const [editing, setEditing] = useState<{ book: CollectionBook; draft: string } | null>(null);
    const [saving, setSaving] = useState(false);
    const [forwardFor, setForwardFor] = useState<CollectionBook | null>(null);
    const [confirmDel, setConfirmDel] = useState<CollectionBook | null>(null);
    const [wallEditorDirty, setWallEditorDirty] = useState(false);
    const [toast, setToast] = useState<{ key: number; msg: string } | null>(null);
    const touch = useRef({ x: 0, y: 0, axis: '' as 'h' | 'v' | '', on: false });

    const charById = useMemo(() => new Map(characters.map(c => [c.id, c])), [characters]);

    const loadBooks = useCallback(async () => {
        try {
            const next = await DB.getAllCollectionBooks();
            setBooks(next);
            const nextWalls = await DB.getAllCollectionWalls();
            setWalls(nextWalls);
            const itemLists = await Promise.all(nextWalls.map(wall => DB.getCollectionWallItemsByWallId(wall.id)));
            const nextWallItems = itemLists.flat();
            setWallItems(nextWallItems);
            const assetIds = Array.from(new Set(nextWallItems.map(item => item.assetId).filter((id): id is string => Boolean(id))));
            const assets = await Promise.all(assetIds.map(id => DB.getCollectionWallAssetById(id)));
            setWallAssets(assets.filter((asset): asset is CollectionWallAsset => Boolean(asset)));
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
    const handleCloseApp = useCallback(() => {
        if (editingWall && wallEditorDirty && !window.confirm('未保存更改')) return;
        closeApp();
    }, [closeApp, editingWall, wallEditorDirty]);

    const sections = useMemo(() => {
        const byChar = new Map<string, CollectionBook[]>();
        for (const b of books) {
            if (!byChar.has(b.charId)) byChar.set(b.charId, []);
            byChar.get(b.charId)!.push(b);
        }
        const wallCharIds = new Set(walls.map(wall => wall.charId).filter(Boolean));
        const assetById = new Map(wallAssets.map(asset => [asset.id, asset]));
        const orderedIds = [
            ...characters.map(c => c.id).filter(id => byChar.has(id) || wallCharIds.has(id)),
            ...Array.from(byChar.keys()).filter(id => !charById.has(id)),
            ...Array.from(wallCharIds).filter(id => !charById.has(id) && !byChar.has(id)),
        ];
        return orderedIds.map(charId => {
            const charBooks = (byChar.get(charId) || []).sort((a, b) => b.collectedAt - a.collectedAt);
            const character = charById.get(charId);
            const freeform = charBooks.filter(b => b.kind === 'freeform');
            const bookById = new Map(charBooks.map(book => [book.id, book]));
            const charWalls = walls
                .filter(wall => wall.charId === charId)
                .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || (a.createdAt || 0) - (b.createdAt || 0));
            const wallBookIds = new Set<string>();
            const wallZones: { wall: CollectionWall; entries: WallZoneEntry[] }[] = charWalls.map(wall => {
                const entries = wallItems
                    .filter(item => item.wallId === wall.id)
                    .sort((a, b) => (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0))
                    .reduce<WallZoneEntry[]>((acc, item) => {
                        if (item.type === 'card' && item.bookId) {
                            const book = bookById.get(item.bookId);
                            if (book?.kind !== 'freeform') return acc;
                            wallBookIds.add(book.id);
                            acc.push({ id: item.id, type: 'book', item, book });
                            return acc;
                        }
                        if (item.type === 'image' && item.assetId) {
                            const asset = assetById.get(item.assetId);
                            if (!asset) return acc;
                            acc.push({ id: item.id, type: 'image', item, asset });
                            return acc;
                        }
                        if (item.type === 'text' && item.text?.content) {
                            acc.push({ id: item.id, type: 'text', item });
                            return acc;
                        }
                        return acc;
                    }, []);
                return { wall, entries };
            }).filter(zone => zone.entries.length > 0);
            const looseFreeform = freeform.filter(book => !wallBookIds.has(book.id));
            if (looseFreeform.length > 0) {
                const fallbackWall = charWalls.find(wall => wall.isDefault) || charWalls[0] || {
                    id: `fallback-${charId}`,
                    charId,
                    name: '未分类',
                    isDefault: true,
                    layoutMode: 'flow',
                    background: { type: 'color', value: '#17120e', fit: 'cover', dim: 0.18 },
                    allowCharDecorate: true,
                    changeCountSinceVisit: 0,
                    hasUnseenCharItem: false,
                    sortOrder: 0,
                    createdAt: 0,
                    updatedAt: 0,
                } satisfies CollectionWall;
                wallZones.push({
                    wall: fallbackWall,
                    entries: looseFreeform.map(book => ({ id: `loose-${book.id}`, type: 'book', book } satisfies WallBookEntry)),
                });
            }
            return {
                char: character || { id: charId, name: '已删除角色' },
                hue: hashOf(charId) % 360,
                afterglow: charBooks.filter(b => b.kind === 'afterglow'),
                heartTalks: charBooks.filter(b => b.kind === 'heart_talk'),
                freeform,
                wallZones,
            };
        });
    }, [books, characters, charById, wallAssets, wallItems, walls]);

    const safePage = Math.min(page, Math.max(0, sections.length - 1));

    useEffect(() => {
        if (page > Math.max(0, sections.length - 1)) setPage(Math.max(0, sections.length - 1));
    }, [sections.length, page]);

    const charOf = (b: CollectionBook) => charById.get(b.charId);

    const handleInviteChar = useCallback(async (wall: CollectionWall, entries: WallZoneEntry[], charName: string) => {
        if (!wall.allowCharDecorate) {
            say('这面墙暂时不让 TA 布置');
            return;
        }
        const anchor = entries.find(entry => entry.type !== 'text') || entries[0];
        if (!anchor) {
            say('先贴一点东西，再邀请 TA 来看');
            return;
        }
        const label = getWallEntryLabel(anchor).slice(0, 18);
        const content = `${label}我看过了。先把这句压在这里，等你下次来。`;
        const items = await DB.getCollectionWallItemsByWallId(wall.id);
        try {
            const noteItem = buildCharWallNoteItem({
                wallId: wall.id,
                layoutMode: wall.layoutMode,
                items,
                content,
                charName,
            });
            await DB.saveCollectionWallItem(noteItem);
            await DB.saveCollectionWall({
                ...wall,
                hasUnseenCharItem: true,
                charLastVisitAt: Date.now(),
                changeCountSinceVisit: 0,
            });
            say('TA 留了一张便签');
            await loadBooks();
        } catch (error) {
            console.error('[CollectionHall] char note failed:', error);
            say('TA 这次没能留下便签');
        }
    }, [loadBooks, say]);

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
            setWallItems(prev => prev.filter(item => item.bookId !== confirmDel.id));
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
            <button type="button" className="ar-exit" aria-label="退出典藏馆" onClick={handleCloseApp}>
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
                    <p>去主聊天收藏番外、谈心或自由创作碎片，这里就会为对应角色添上一处可翻看的痕迹。</p>
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
                            {sections.map(({ char, hue, afterglow, heartTalks, freeform, wallZones }) => (
                                <div className="ar-page" key={char.id}>
                                    <div className="ar-char-hd">
                                        <Avatar char={char} hue={hue} size={36} />
                                        <div>
                                            <h2 className="ar-char-name">{char.name}</h2>
                                            <p className="ar-char-meta">
                                                {afterglow.length > 0 && `${afterglow.length} 本番外`}
                                                {afterglow.length > 0 && heartTalks.length > 0 && ' · '}
                                                {heartTalks.length > 0 && `${heartTalks.length} 张谈心`}
                                                {(afterglow.length > 0 || heartTalks.length > 0) && freeform.length > 0 && ' · '}
                                                {freeform.length > 0 && `${freeform.length} 枚碎片`}
                                            </p>
                                        </div>
                                    </div>
                                    {afterglow.length > 0 && (
                                        <BookCabinet char={char} books={afterglow} pullingId={pullingId} onPick={pick} />
                                    )}
                                    {heartTalks.length > 0 && (
                                        <KeepsakeBox books={heartTalks} pullingId={pullingId} onPick={pick} />
                                    )}
                                    {wallZones.map(zone => (
                                        <LightWallZone
                                            key={zone.wall.id}
                                            wall={zone.wall}
                                            entries={zone.entries}
                                            pullingId={pullingId}
                                            onPickBook={pick}
                                            onPickImage={entry => setSelectedImage({ entry, wallName: zone.wall.name })}
                                            onEditWall={(wall, entries) => setEditingWall({ wall, entries })}
                                            onInviteChar={(wall, entries) => void handleInviteChar(wall, entries, char.name)}
                                        />
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}

            {selected && (
                selected.kind === 'freeform' ? (
                    <FreeformReader
                        book={selected}
                        char={charOf(selected)}
                        onClose={() => setSelected(null)}
                        onEdit={() => setEditing({ book: selected, draft: selected.customTitle?.trim() || getCollectionDisplayTitle(selected) })}
                        onForward={() => setForwardFor(selected)}
                        onDelete={() => setConfirmDel(selected)}
                    />
                ) : (
                    <EbookReader
                        book={selected}
                        char={charOf(selected)}
                        onClose={() => setSelected(null)}
                        onEdit={() => setEditing({ book: selected, draft: selected.customTitle?.trim() || getCollectionDisplayTitle(selected) })}
                        onForward={() => setForwardFor(selected)}
                        onDelete={() => setConfirmDel(selected)}
                    />
                )
            )}

            {selectedImage && (
                <WallImageReader
                    entry={selectedImage.entry}
                    wallName={selectedImage.wallName}
                    onClose={() => setSelectedImage(null)}
                />
            )}

            {editingWall && (
                <WallEditor
                    wall={editingWall.wall}
                    entries={editingWall.entries}
                    onClose={() => setEditingWall(null)}
                    onSaved={() => void loadBooks()}
                    onDirtyChange={setWallEditorDirty}
                    say={say}
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
                                <h3>{editing.book.kind === 'heart_talk' ? '重写谈心标签' : editing.book.kind === 'freeform' ? '重写碎片标签' : '重写书脊标签'}</h3>
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

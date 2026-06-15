import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Moveable from 'react-moveable';
import { ArrowClockwise, ArrowCounterClockwise, ArrowDown, ArrowUp, Check, ImageSquare, PaintBrush, PaperPlaneTilt, PencilSimple, Sticker, Trash, UploadSimple, X } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { AppID, type APIConfig, type CharacterProfile, type CollectionBook, type CollectionWall, type CollectionWallAsset, type CollectionWallItem, type CollectionWallRemarkTemplate, type GalleryImage, type GroupProfile, type Message, type RealtimeConfig, type UserProfile } from '../types';
import { DB } from '../utils/db';
import {
    buildCollectionForwardPayload,
    formatCollectionKindLabel,
    getCollectionDisplayTitle,
} from '../utils/collectionBooks';
import { addCollectionWallPendingContext } from '../utils/collectionWallContext';
import {
    buildCharWallNoteItem,
    buildCollectionWallVisitSystemPrompt,
    buildCollectionWallVisitUserPrompt,
    isDuplicateCharWallRemark,
    requestCharWallNote,
    type ChatCompletionMessage,
    type CollectionWallVisitTrigger,
    type CollectionWallManifest,
    type CollectionWallManifestItem,
} from '../utils/collectionWallCoCreation';
import { hasWallEditorDraftChanges, serializeWallEditorDraft } from '../utils/collectionWallEditorDraft';
import { saveCollectionWallEditorDraftSnapshot } from '../utils/collectionWallSaveFlow';
import { ChatPrompts } from '../utils/chatPrompts';
import { loadCharacterGoals } from '../utils/goalService';
import { getEmbeddingConfig } from '../utils/runtimeConfig';
import { getGalleryImageDisplayUrl } from '../utils/generatedImageStorage';
import { fnv1aBytes } from '../utils/fnv1a';
import {
    clearCollectionWallDebugLogs,
    formatCollectionWallDebugDiagnostics,
    formatCollectionWallDebugEntrySummary,
    getCollectionWallDebugLogs,
    subscribeCollectionWallDebugLogs,
    type CollectionWallDebugLogEntry,
} from '../utils/collectionWallDebugLog';
import { injectFreeformCompatScript } from '../components/chat/statusCardIframe';
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
  --tk-ink:#161616;
  --tk-ink-soft:#3a3a3a;
  --tk-grey:#8f8f8c;
  --tk-grey-lt:#c8c8c4;
  --tk-hairline:#e6e6e2;
  --tk-stamp:#c33d22;
  --tk-paper-a:#fefefd;
  --tk-paper-b:#f8f8f6;
  --tk-font-serif:Georgia,'Times New Roman','Noto Serif SC','Songti SC','STSong',serif;
  --tk-font-mono:ui-monospace,'SF Mono','Roboto Mono',Menlo,Consolas,monospace;
  --tk-font-note:'Kaiti SC',STKaiti,'KaiTi','Noto Serif SC',serif;
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
.ar-wall-list{display:flex;flex-direction:column;gap:10px;margin:18px 16px 34px}
.ar-wall-card-wrap{position:relative}
.ar-wall-card{position:relative;display:flex;flex-direction:column;gap:10px;width:100%;min-height:112px;border-radius:8px;padding:14px 13px;text-align:left;overflow:hidden;background:linear-gradient(145deg,#f5efe2,#efe7d6);box-shadow:0 18px 40px -28px rgba(0,0,0,.8),inset 0 0 0 1px rgba(255,255,255,.48);transition:transform .16s,box-shadow .16s}
.ar-wall-card:hover{transform:translateY(-2px);box-shadow:0 24px 48px -30px rgba(0,0,0,.85),inset 0 0 0 1px rgba(201,163,106,.34)}
.ar-wall-card:active{transform:translateY(0) scale(.99)}
.ar-wall-card-main{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;width:100%;min-height:76px;padding:0;border:0;background:transparent;text-align:left;cursor:pointer;color:inherit}
.ar-wall-card-copy{min-width:0}
.ar-wall-card h3{position:relative;z-index:1;margin:0;font-family:var(--ar-font-display);font-size:20px;line-height:1.1;color:#231a12;letter-spacing:.04em}
.ar-wall-card p{position:relative;z-index:1;margin:6px 0 0;font-size:11px;font-weight:800;color:#a83a4e;letter-spacing:.12em}
.ar-wall-seen{position:absolute;right:13px;top:12px;width:8px;height:8px;border-radius:999px;background:var(--ar-accent);box-shadow:0 0 0 4px rgba(201,163,106,.16)}
.ar-wall-teasers{position:relative;z-index:1;display:flex;flex-direction:column;gap:5px;margin-top:12px}
.ar-wall-teaser{display:flex;align-items:center;gap:7px;min-width:0;color:#5f503f;font-size:11px;font-weight:700}
.ar-wall-teaser i{flex:none;width:28px;height:18px;border-radius:2px;background:linear-gradient(145deg,#ddcfb4,#f7f0e2);box-shadow:inset 0 0 0 1px rgba(63,48,31,.12)}
.ar-wall-teaser span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ar-wall-card-count{position:relative;z-index:1;align-self:end;text-align:right;font-family:var(--ar-font-display);font-size:34px;line-height:.85;color:#a83a4e}
.ar-wall-card-count small{display:block;margin-top:5px;font-family:var(--ar-font-ui);font-size:8px;font-weight:900;letter-spacing:.24em;color:#72593d}
.ar-wall-invite{position:relative;z-index:2;align-self:flex-start;max-width:100%;height:28px;border:1px solid rgba(168,58,78,.22);border-radius:999px;background:rgba(255,250,241,.72);color:#7c4d3f;padding:0 12px;font-size:10px;font-weight:900;letter-spacing:.08em;cursor:pointer;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);transition:transform .16s,border-color .16s,background .16s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ar-wall-invite:hover{transform:translateY(-1px);border-color:rgba(168,58,78,.34);background:rgba(255,250,241,.84)}
.ar-wall-invite:disabled{opacity:.54;cursor:wait;transform:none}
.ar-wall-empty-list{margin:18px 16px 34px;border:1px dashed rgba(201,163,106,.2);border-radius:10px;padding:20px 16px;text-align:center;color:var(--ar-t3);font-size:12px;line-height:1.8;background:rgba(255,236,210,.035)}
.ar-full-wall{position:fixed;inset:0;z-index:90;overflow:hidden;background:#17120e;color:#f4ead8;touch-action:none}
.ar-full-wall.editing{overflow:hidden;touch-action:none}
.ar-full-wall.preview{scrollbar-width:none;-ms-overflow-style:none;cursor:pointer}
.ar-full-wall.preview::-webkit-scrollbar{display:none}
.ar-full-bg{position:fixed;inset:0;pointer-events:none;background:var(--wall-bg,#17120e)}
.ar-full-bg::after{content:'';position:absolute;inset:0;background:rgba(0,0,0,var(--wall-dim,.18))}
.ar-full-bg::before{content:'';position:absolute;inset:0;background-image:${NOISE};opacity:var(--wall-noise-opacity,.035);mix-blend-mode:overlay}
.ar-full-exit,.ar-full-action,.ar-edit-toolbar button,.ar-tray-item,.ar-wall-item-menu button{display:inline-flex;align-items:center;justify-content:center;border:1px solid rgba(255,236,210,.18);background:rgba(11,9,7,.64);color:rgba(246,232,206,.9);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);cursor:pointer;box-shadow:0 14px 34px -24px rgba(0,0,0,.95)}
.ar-full-exit{position:fixed;left:14px;top:calc(env(safe-area-inset-top,0px) + 14px);z-index:5;width:38px;height:38px;border-radius:999px;font-size:28px;line-height:1}
.ar-full-actions{position:fixed;right:14px;top:calc(env(safe-area-inset-top,0px) + 14px);z-index:5;display:flex;flex-direction:column;align-items:flex-end;gap:8px}
.ar-full-action{height:38px;border-radius:999px;padding:0 13px;gap:6px;font-size:12px;font-weight:900;letter-spacing:.08em}
.ar-full-action-menu{display:flex;flex-direction:column;gap:8px;padding:7px;border:1px solid rgba(247,202,214,.55);border-radius:18px;background:rgba(255,255,255,.88);box-shadow:0 18px 40px -26px rgba(120,80,90,.7),inset 0 1px 0 #fff;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
.ar-full-menu-action{height:36px;min-width:84px;border:1px solid rgba(231,140,160,.32);border-radius:999px;background:rgba(255,255,255,.75);color:var(--wall-ink);font-size:12px;font-weight:800;cursor:pointer}
.ar-full-menu-action.primary{border-color:transparent;background:linear-gradient(180deg,var(--wall-rose-hi),var(--wall-rose));color:#fff;box-shadow:0 12px 22px -14px rgba(228,124,151,.85)}
.ar-full-wall.preview .ar-full-exit,.ar-full-wall.preview .ar-full-actions,.ar-full-wall.preview .ar-edit-toolbar,.ar-full-wall.preview .ar-tray,.ar-full-wall.preview .moveable-control-box,.ar-full-wall.preview .ar-selection-actions,.ar-full-wall.preview .ar-text-style-panel,.ar-full-wall.preview .ar-asset-sheet{display:none!important}
.ar-full-stage-wrap{position:relative;width:100%;height:100dvh;min-height:0;overflow:hidden}
.ar-full-canvas{position:absolute;left:0;top:0;width:750px;transform:scale(var(--wall-scale,1));transform-origin:top left;isolation:isolate}
.ar-edit-toolbar{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 14px);z-index:6;display:flex;gap:8px;transform:translateX(-50%);padding:6px;border-radius:999px;background:rgba(11,9,7,.44);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
.ar-edit-toolbar button{height:36px;border-radius:999px;padding:0 12px;gap:6px;font-size:12px;font-weight:800}
.ar-edit-toolbar button:disabled{opacity:.45;cursor:default}
.ar-tray{position:fixed;left:0;right:0;top:calc(env(safe-area-inset-top,0px) + 62px);z-index:5;display:flex;gap:8px;overflow-x:auto;padding:0 12px 8px;scrollbar-width:none}
.ar-tray::-webkit-scrollbar{display:none}
.ar-tray-item{flex:none;min-width:118px;height:38px;border-radius:999px;padding:0 13px;font-size:12px;font-weight:800;gap:6px;white-space:nowrap}
.ar-wall-free-item{position:absolute;left:0;top:0;z-index:var(--z,1);width:var(--item-w,320px);height:var(--item-h,260px);transform:translate3d(var(--x,0px),var(--y,0px),0) rotate(var(--r,0deg));transform-origin:center center;touch-action:auto}
.ar-wall-free-item.editing{touch-action:none;cursor:grab}
.ar-wall-free-item.selected{outline:1px solid rgba(245,224,181,.9);outline-offset:5px}
.ar-full-wall.editing .ar-wall-free-item.selected,.ar-wall-free-item.dragging{z-index:10000}
.ar-wall-free-item.dragging{cursor:grabbing}
.ar-wall-free-item button{font:inherit}
.ar-live-card{position:absolute;inset:0;overflow:hidden;background:transparent}
.ar-live-card-frame{position:absolute;left:0;top:0;width:375px;height:var(--frame-h,320px);border:0;border-radius:0;background:transparent;color-scheme:light dark;overflow:hidden;display:block;pointer-events:none;transform:scale(var(--card-scale,1));transform-origin:top left;opacity:0;transition:opacity 200ms ease}
.ar-live-card-frame.mounted{opacity:1}
.ar-live-card-placeholder{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;border:1px solid rgba(68,55,40,.22);background:rgba(255,250,241,.88);color:#2b241d;font-family:var(--ar-font-display);font-size:20px;font-weight:700;line-height:1.2;text-align:center;padding:18px;overflow:hidden}
.ar-live-card-missing{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;border:1px dashed rgba(255,236,210,.34);color:rgba(255,236,210,.82);font-size:12px;line-height:1.7;text-align:center;padding:18px;background:rgba(0,0,0,.18)}
.ar-wall-img-item{position:absolute;inset:0;overflow:hidden;border-radius:3px;background:#100f0d;box-shadow:0 18px 34px -26px rgba(0,0,0,.92)}
.ar-wall-img-item img{display:block;width:100%;height:100%;object-fit:cover;pointer-events:none;-webkit-user-drag:none;-webkit-touch-callout:none;user-select:none}
.ar-wall-img-item.transparent{background:transparent;box-shadow:none;border-radius:0}
.ar-wall-img-item.transparent img{object-fit:contain;filter:drop-shadow(0 10px 12px rgba(0,0,0,.38))}
.ar-wall-img-item.sticker{background:transparent;box-shadow:none;border-radius:0}
.ar-wall-img-item.sticker img{object-fit:contain;filter:drop-shadow(0 10px 12px rgba(0,0,0,.38))}
.ar-wall-note-item{position:absolute;inset:0;overflow:hidden;border-radius:6px;background:#fff2a8;color:#342a1d;padding:20px 16px 14px;box-shadow:0 18px 34px -26px rgba(0,0,0,.82),inset 0 0 0 1px rgba(110,92,42,.14)}
.ar-wall-note-item.char{background:#fff6c5}
.ar-wall-note-item p{margin:0;font-family:'Kaiti SC',STKaiti,'楷体',serif;font-size:20px;line-height:1.55;white-space:pre-wrap;word-break:break-word}
.ar-wall-note-item small{position:absolute;left:16px;right:16px;bottom:12px;border-top:1px solid rgba(80,62,26,.14);padding-top:7px;font-size:9px;font-weight:900;letter-spacing:.2em;color:#8b6d28}
.ar-wall-text-item{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:visible;background:transparent;padding:8px;color:var(--wall-ink-strong)}
.ar-wall-text-item p{margin:0;width:100%;line-height:1.22;white-space:pre-wrap;word-break:break-word}
.ar-bond-widget{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:999px;background:linear-gradient(135deg,rgba(255,252,244,.96),rgba(244,234,216,.92));box-shadow:0 18px 34px -24px rgba(56,42,24,.55),inset 0 0 0 1px rgba(170,134,78,.18),inset 0 1px 0 rgba(255,255,255,.9);color:#7a6040}
.ar-bond-widget::before{content:'';position:absolute;left:18px;right:18px;top:50%;height:1px;background:linear-gradient(90deg,transparent,rgba(196,157,96,.54),transparent)}
.ar-bond-widget::after{content:'';position:absolute;inset:7px;border:1px solid rgba(196,157,96,.14);border-radius:999px;pointer-events:none}
.ar-bond-avatar{position:relative;z-index:2;width:58px;height:58px;border-radius:999px;padding:3px;background:linear-gradient(145deg,#fffaf0,#e8d7b5);box-shadow:0 8px 18px -12px rgba(60,44,24,.58),inset 0 0 0 1px rgba(151,111,58,.18)}
.ar-bond-avatar img,.ar-bond-avatar span{display:flex;width:100%;height:100%;align-items:center;justify-content:center;border-radius:inherit;object-fit:cover;background:linear-gradient(145deg,#f9efe0,#dcc8a5);color:#8b6b44;font-family:var(--ar-font-display);font-size:24px;font-weight:800}
.ar-bond-avatar.char{margin-left:-4px}
.ar-bond-link{position:relative;z-index:3;display:flex;align-items:center;justify-content:center;width:66px;height:30px;margin:0 -4px;border-radius:999px;background:linear-gradient(180deg,#fff7e8,#ecd7b7);box-shadow:0 8px 18px -14px rgba(65,46,22,.55),inset 0 0 0 1px rgba(190,148,78,.24);font-family:var(--ar-font-script);font-size:19px;color:#b38749}
.ar-bond-meta{position:absolute;left:0;right:0;bottom:11px;z-index:4;display:flex;justify-content:center;gap:7px;min-width:0;padding:0 20px;font-size:9px;font-weight:900;letter-spacing:.16em;color:rgba(122,96,64,.72);text-transform:uppercase}
.ar-bond-meta b{max-width:82px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:inherit;color:inherit}
.ar-pinned-remark{position:absolute;inset:0;overflow:hidden;color:var(--tk-ink-soft);background:linear-gradient(180deg,var(--tk-paper-a),var(--tk-paper-b));box-shadow:0 18px 34px -26px rgba(0,0,0,.72),inset 0 0 0 1px var(--tk-hairline)}
.ar-pinned-remark .txt{white-space:pre-wrap;word-break:break-word}
.ar-pinned-remark.ticket{border-radius:4px;padding:14px 15px 38px 18px}.ar-pinned-remark.ticket::after{content:'到访';position:absolute;right:12px;top:14px;width:44px;height:44px;display:flex;align-items:center;justify-content:center;border:2px solid var(--tk-stamp);border-radius:999px;color:var(--tk-stamp);font-size:11px;font-weight:900;letter-spacing:.18em;transform:rotate(-12deg);opacity:.78;mix-blend-mode:multiply}.ar-pinned-remark.ticket .hd{display:flex;justify-content:space-between;margin-bottom:10px;color:var(--tk-grey);font-family:var(--tk-font-mono);font-size:8px;letter-spacing:.2em}.ar-pinned-remark.ticket .txt{font-family:var(--tk-font-serif);font-size:15px;line-height:1.65;padding-right:42px}.ar-pinned-remark.ticket .foot{position:absolute;left:15px;right:15px;bottom:12px;border-top:1px dashed var(--tk-grey-lt);padding-top:8px;color:var(--tk-grey);font-family:var(--tk-font-mono);font-size:8px;letter-spacing:.18em}
.ar-pinned-remark.pol{border-radius:4px;background:#fff;padding:10px 10px 38px;transform:rotate(-1deg)}.ar-pinned-pol-photo{height:58px;overflow:hidden;background:#eae2d4}.ar-pinned-pol-photo img{width:100%;height:100%;object-fit:cover;filter:saturate(.85) contrast(.96)}.ar-pinned-remark.pol .txt{padding:9px 3px 0;font-family:var(--tk-font-note);font-size:15px;line-height:1.45;color:#2b2b2b}.ar-pinned-remark.pol .foot{position:absolute;left:13px;right:13px;bottom:10px;display:flex;justify-content:space-between;color:var(--tk-grey);font-family:var(--tk-font-mono);font-size:8px;letter-spacing:.18em}
.ar-pinned-remark.card{border-radius:12px;background:#fbfbfa}.ar-pinned-remark.card .art{height:42%;overflow:hidden;background:#14161a}.ar-pinned-remark.card .art img{width:100%;height:100%;object-fit:cover}.ar-pinned-remark.card .name{display:flex;justify-content:space-between;padding:8px 12px 0;color:var(--tk-grey);font-size:8px;font-weight:900;letter-spacing:.2em}.ar-pinned-remark.card .name b{color:var(--tk-ink);font-size:12px}.ar-pinned-remark.card .txt{padding:7px 12px 0;font-family:var(--tk-font-serif);font-size:13px;line-height:1.5}.ar-pinned-remark.card::after{content:'';position:absolute;inset:0;background:linear-gradient(110deg,transparent 38%,rgba(255,255,255,.45) 48%,transparent 58%);transform:translateX(35%);pointer-events:none}
.ar-pinned-remark.letter{border-radius:4px;padding:14px 16px;background:linear-gradient(180deg,rgba(0,0,0,.035) 0,transparent 1px) 0 33%/100% 1px no-repeat,linear-gradient(180deg,var(--tk-paper-a),var(--tk-paper-b))}.ar-pinned-remark.letter .hd{display:flex;justify-content:space-between;margin-bottom:9px;color:var(--tk-grey);font-family:var(--tk-font-mono);font-size:8px;letter-spacing:.18em}.ar-pinned-remark.letter .txt{font-family:var(--tk-font-serif);font-size:14px;line-height:1.7}.ar-pinned-remark.letter .seal{display:inline-flex;width:17px;height:17px;margin-left:5px;align-items:center;justify-content:center;border-radius:3px;background:var(--tk-stamp);color:white;font-family:var(--tk-font-serif);font-size:11px;transform:rotate(4deg);opacity:.9}
.ar-pinned-remark.receipt{border-radius:0;background:#fdfdfc;padding:13px 13px 18px;filter:drop-shadow(0 18px 24px rgba(0,0,0,.18))}.ar-pinned-remark.receipt::after{content:'';position:absolute;left:0;right:0;bottom:0;height:7px;background:linear-gradient(135deg,#fdfdfc 50%,transparent 50%) 0 0/14px 14px repeat-x,linear-gradient(225deg,#fdfdfc 50%,transparent 50%) 7px 0/14px 14px repeat-x}.ar-pinned-remark.receipt .ln{margin:0;color:#232323;font-family:var(--tk-font-mono);font-size:10px;line-height:1.55;letter-spacing:.04em;white-space:pre-wrap;word-break:break-all}.ar-pinned-remark.receipt .ln.c{text-align:center}.ar-pinned-remark.receipt .stamp{position:absolute;right:12px;bottom:18px;border:1.5px dashed var(--tk-stamp);border-radius:5px;padding:4px 7px;color:var(--tk-stamp);font-size:10px;font-weight:900;letter-spacing:.14em;transform:rotate(-8deg);opacity:.82}
.ar-note-editor{position:absolute;inset:8px;z-index:3;border:1px solid rgba(80,62,26,.2);border-radius:4px;background:rgba(255,252,224,.96);color:#302719;font:20px/1.55 'Kaiti SC',STKaiti,'楷体',serif;resize:none;outline:none;padding:10px}
.ar-wall-item-menu{position:fixed;z-index:7;display:flex;gap:6px;padding:6px;border-radius:999px;background:rgba(11,9,7,.62);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
.ar-wall-item-menu button{height:32px;border-radius:999px;padding:0 11px;font-size:11px;font-weight:800}
.ar-selection-actions{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 68px);z-index:7;display:flex;gap:7px;max-width:calc(100% - 18px);overflow-x:auto;transform:translateX(-50%);padding:6px;border:1px solid rgba(255,236,210,.16);border-radius:999px;background:rgba(17,13,10,.72);box-shadow:0 18px 38px -24px rgba(0,0,0,.9);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);scrollbar-width:none}
.ar-selection-actions::-webkit-scrollbar{display:none}
.ar-selection-actions button{flex:none;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:32px;border:1px solid rgba(255,236,210,.16);border-radius:999px;background:rgba(11,9,7,.72);color:var(--ar-t2);padding:0 12px;font-size:11px;font-weight:900;cursor:pointer;white-space:nowrap}
.ar-selection-actions button.danger{color:#e6b3a8;border-color:rgba(200,110,96,.3)}
.ar-text-style-panel{position:fixed;left:10px;right:10px;bottom:calc(env(safe-area-inset-bottom,0px) + 112px);z-index:7;display:flex;flex-direction:column;gap:10px;border:1px solid rgba(255,236,210,.16);border-radius:18px;background:rgba(17,13,10,.86);color:var(--ar-t1);padding:12px;box-shadow:0 28px 70px -34px rgba(0,0,0,.95),inset 0 1px 0 rgba(255,236,210,.08);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
.ar-text-style-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
.ar-text-style-head b{display:block;font-size:13px;letter-spacing:.08em}
.ar-text-style-head small{display:block;margin-top:3px;color:var(--ar-t3);font-size:10px}
.ar-text-style-head button,.ar-text-style-actions button{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:31px;border:1px solid rgba(201,163,106,.34);border-radius:999px;background:rgba(11,9,7,.62);color:var(--ar-accent);padding:0 10px;font-size:11px;font-weight:900;cursor:pointer}
.ar-text-color-row{display:flex;align-items:center;gap:8px;overflow-x:auto;scrollbar-width:none}
.ar-text-color-row::-webkit-scrollbar{display:none}
.ar-text-color-row>button{flex:none;width:28px;height:28px;border:1px solid rgba(255,236,210,.2);border-radius:999px;background:var(--text-color);box-shadow:inset 0 0 0 2px rgba(255,255,255,.18);cursor:pointer}
.ar-text-color-row>button.on{outline:2px solid var(--ar-accent);outline-offset:2px}
.ar-text-color-picker{flex:none;display:flex;align-items:center;gap:6px;height:30px;border:1px solid rgba(255,236,210,.14);border-radius:999px;padding:0 9px;color:var(--ar-t2);font-size:10px;font-weight:900}
.ar-text-color-picker input{width:22px;height:22px;border:0;background:transparent;padding:0}
.ar-text-range{display:flex;align-items:center;gap:10px}
.ar-text-range span{flex:none;width:70px;color:var(--ar-t2);font-size:10px;font-weight:900}
.ar-text-range input{flex:1;accent-color:var(--ar-accent)}
.ar-text-style-actions{display:flex;align-items:center;gap:7px;overflow-x:auto;scrollbar-width:none}
.ar-text-style-actions::-webkit-scrollbar{display:none}
.ar-text-style-actions button.on{background:rgba(201,163,106,.16);color:var(--ar-t1)}
.ar-text-stroke{flex:none;display:flex;align-items:center;gap:6px;height:31px;border:1px solid rgba(255,236,210,.14);border-radius:999px;padding:0 10px;color:var(--ar-t2);font-size:11px;font-weight:900}
.ar-text-stroke input{accent-color:var(--ar-accent)}
.ar-asset-drawer{position:fixed;left:10px;right:10px;bottom:calc(env(safe-area-inset-bottom,0px) + 66px);z-index:8;height:min(72dvh,620px);max-height:calc(100dvh - env(safe-area-inset-top,0px) - 132px);display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(255,236,210,.16);border-radius:18px;background:rgba(17,13,10,.88);color:var(--ar-t1);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 28px 80px -34px rgba(0,0,0,.95),inset 0 1px 0 rgba(255,236,210,.08)}
.ar-asset-drawer-hd{flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 14px 10px;border-bottom:1px solid var(--ar-line)}
.ar-asset-drawer-hd h3{margin:0;font-size:14px;font-weight:900;letter-spacing:.08em}
.ar-asset-drawer-hd p{margin:3px 0 0;font-size:10px;color:var(--ar-t3);letter-spacing:.08em}
.ar-asset-upload{flex:none;display:inline-flex;align-items:center;gap:6px;height:34px;border:1px solid rgba(201,163,106,.42);border-radius:999px;background:transparent;color:var(--ar-accent);padding:0 12px;font-size:12px;font-weight:900;cursor:pointer}
.ar-asset-upload:disabled{opacity:.56;cursor:wait}
.ar-asset-empty{margin:18px 14px 16px;border:1px dashed rgba(201,163,106,.24);border-radius:14px;padding:22px 16px;text-align:center;color:var(--ar-t3);font-size:12px;line-height:1.8;background:rgba(255,236,210,.035)}
.ar-asset-grid{flex:1;min-height:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));align-content:start;gap:10px;overflow-y:auto;overscroll-behavior:contain;padding:12px 14px calc(env(safe-area-inset-bottom,0px) + 26px);scrollbar-width:none;-webkit-overflow-scrolling:touch}
.ar-asset-grid::-webkit-scrollbar{display:none}
.ar-asset-card{min-width:0;display:flex;flex-direction:column;border:1px solid var(--ar-line);border-radius:14px;background:rgba(255,236,210,.04);overflow:hidden}
.ar-asset-thumb{position:relative;display:flex;align-items:center;justify-content:center;width:100%;aspect-ratio:1;border:0;padding:0;background:rgba(0,0,0,.2);cursor:pointer;-webkit-touch-callout:none;user-select:none}
.ar-asset-thumb img{display:block;width:100%;height:100%;object-fit:contain;pointer-events:none;-webkit-user-drag:none;-webkit-touch-callout:none;user-select:none}
.ar-asset-use-chip{position:absolute;right:6px;bottom:6px;display:inline-flex;align-items:center;justify-content:center;height:22px;border-radius:999px;background:rgba(11,9,7,.72);color:var(--ar-accent);padding:0 8px;font-size:10px;font-weight:900;letter-spacing:.04em;box-shadow:0 8px 18px -12px rgba(0,0,0,.8);pointer-events:none}
.ar-asset-card b{display:block;margin:7px 8px 9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:1.15;color:var(--ar-t1)}
.ar-asset-actions{display:none}
.ar-asset-actions button{min-width:0;height:28px;display:inline-flex;align-items:center;justify-content:center;gap:4px;border:1px solid var(--ar-line);border-radius:999px;background:#100c09;color:var(--ar-t2);font-size:10px;font-weight:900;cursor:pointer}
.ar-asset-actions button:hover{color:var(--ar-t1);border-color:rgba(201,163,106,.35)}
.ar-asset-actions button.wide{grid-column:1 / -1}
.ar-asset-actions button.primary{border-color:rgba(201,163,106,.46);background:linear-gradient(180deg,rgba(245,224,181,.18),rgba(201,163,106,.10));color:var(--ar-accent)}
.ar-asset-sheet{position:fixed;left:18px;right:18px;bottom:calc(env(safe-area-inset-bottom,0px) + 96px);z-index:9;display:grid;grid-template-columns:72px minmax(0,1fr);gap:12px;border:1px solid rgba(255,236,210,.16);border-radius:20px;background:rgba(17,13,10,.92);color:var(--ar-t1);padding:12px;box-shadow:0 28px 80px -34px rgba(0,0,0,.95),inset 0 1px 0 rgba(255,236,210,.08);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
.ar-asset-sheet-preview{grid-row:span 2;display:flex;align-items:center;justify-content:center;width:72px;height:72px;border-radius:14px;background:rgba(0,0,0,.22);overflow:hidden;-webkit-touch-callout:none;user-select:none}
.ar-asset-sheet-preview img{display:block;width:100%;height:100%;object-fit:contain;pointer-events:none;-webkit-user-drag:none;-webkit-touch-callout:none;user-select:none}
.ar-asset-sheet-copy{min-width:0;align-self:center}
.ar-asset-sheet-copy b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}
.ar-asset-sheet-copy small{display:block;margin-top:4px;color:var(--ar-t3);font-size:10px;font-weight:800;letter-spacing:.12em}
.ar-asset-sheet-actions{grid-column:1 / -1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.ar-asset-sheet-actions button{min-width:0;height:36px;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--ar-line);border-radius:999px;background:#100c09;color:var(--ar-t2);font-size:11px;font-weight:900;cursor:pointer}
.ar-asset-sheet-actions button.primary{grid-column:1 / -1;border-color:rgba(201,163,106,.46);background:linear-gradient(180deg,rgba(245,224,181,.18),rgba(201,163,106,.10));color:var(--ar-accent)}
.ar-asset-sheet-actions button.danger{color:#e6b3a8;border-color:rgba(200,110,96,.32)}
.ar-wall-empty-canvas{position:absolute;left:50%;top:45dvh;transform:translate(-50%,-50%);width:280px;text-align:center;color:rgba(246,232,206,.6);font-size:13px;line-height:1.9}

/* ---------- light wall fullscreen refresh ---------- */
.ar-full-wall{--wall-petal:#fff6f2;--wall-blush:#fbe9ee;--wall-blush-soft:#fff1f5;--wall-sage:#eaf1e6;--wall-sage-ink:#5e7a57;--wall-lilac:#efe7f6;--wall-lilac-ink:#6e5a8e;--wall-line:rgba(247,202,214,.58);--wall-rose:#e2718d;--wall-rose-hi:#ee89a2;--wall-rose-ink:#9f4f64;--wall-ink:#76565b;--wall-ink-strong:#4d3438;--wall-ink-soft:#9a7379;--wall-gold:#d9c49b;--ar-font-hand:'Kaiti SC',STKaiti,'KaiTi','Noto Serif SC',serif;background:var(--wall-petal);color:var(--wall-ink);font-family:var(--ar-font-ui)}
.ar-full-wall.editing{overflow:hidden;touch-action:none}
.ar-full-wall.preview .ar-full-exit,.ar-full-wall.preview .ar-full-actions,.ar-full-wall.preview .ar-edit-toolbar,.ar-full-wall.preview .ar-tray,.ar-full-wall.preview .moveable-control-box,.ar-full-wall.preview .ar-wall-item-menu,.ar-full-wall.preview .ar-asset-drawer,.ar-full-wall.preview .html-modal,.ar-full-wall.preview .ar-selection-actions,.ar-full-wall.preview .ar-text-style-panel,.ar-full-wall.preview .ar-asset-sheet{display:none!important}
.ar-full-bg{position:fixed;inset:0;pointer-events:none;background:var(--wall-bg,var(--wall-petal))}
.ar-full-bg::after{content:'';position:absolute;inset:0;background:rgba(0,0,0,var(--wall-dim,.02))}
.ar-full-bg::before{content:'';position:absolute;inset:0;background-image:${NOISE};opacity:var(--wall-noise-opacity,.03);mix-blend-mode:multiply}
.ar-full-exit,.ar-full-action,.ar-edit-toolbar button,.ar-tray-item,.ar-wall-item-menu button{border:1px solid rgba(231,140,160,.35);background:rgba(255,255,255,.85);color:var(--wall-ink);box-shadow:0 12px 26px -20px rgba(120,80,90,.7);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.ar-full-exit{width:40px;height:40px;border-radius:999px;color:var(--wall-rose-ink);font-size:26px}
.ar-full-action{height:40px;border-radius:999px;padding:0 15px;gap:6px;font-size:12px;font-weight:800;letter-spacing:.04em}
.ar-full-actions .ar-full-action:first-child{border-color:transparent;background:linear-gradient(180deg,var(--wall-rose-hi),var(--wall-rose));color:#fff;box-shadow:0 12px 22px -12px rgba(228,124,151,.85)}
.ar-full-action:active,.ar-full-exit:active,.ar-edit-toolbar button:active,.ar-tray-item:active,.ar-wall-item-menu button:active{transform:scale(.96)}
.ar-full-stage-wrap{position:relative;width:100%;height:100dvh;min-height:0;overflow:hidden}
.ar-full-canvas{position:absolute;left:0;top:0;width:750px;transform:scale(var(--wall-scale,1));transform-origin:top left;isolation:isolate}
.ar-tray{position:fixed;left:0;right:0;top:calc(env(safe-area-inset-top,0px) + 64px);z-index:5;display:flex;gap:8px;overflow-x:auto;padding:0 12px 8px;scrollbar-width:none}
.ar-tray-item{flex:none;min-width:118px;height:40px;border-radius:999px;padding:0 14px;color:var(--wall-rose-ink);font-size:12px;font-weight:800;gap:6px;white-space:nowrap}
.ar-wall-free-item{transition:filter .16s ease}
.ar-wall-free-item.selected{outline:1.5px solid rgba(228,124,151,.95);outline-offset:5px;border-radius:6px}
.ar-wall-free-item.dragging{filter:drop-shadow(0 18px 22px rgba(150,90,110,.3))}
.ar-live-card-placeholder{border:1px solid rgba(231,140,160,.3);background:rgba(255,250,251,.92);color:var(--wall-ink-strong);font-family:var(--ar-font-display);font-size:20px;font-weight:600}
.ticket-card{position:absolute;inset:0;overflow:hidden;border-radius:6px;background:linear-gradient(180deg,#fff,#fff1f4);color:var(--wall-ink);padding:28px 22px;box-shadow:0 18px 34px -26px rgba(150,90,110,.6),inset 0 0 0 1px rgba(247,202,214,.55)}
.ticket-card::before,.ticket-card::after{content:'';position:absolute;top:50%;width:28px;height:28px;border-radius:999px;background:var(--wall-bg,var(--wall-petal));transform:translateY(-50%)}
.ticket-card::before{left:-14px}.ticket-card::after{right:-14px}
.ticket-card b{display:block;font-family:var(--ar-font-display);font-weight:600;font-size:28px;line-height:1.05;color:var(--wall-ink-strong)}
.ticket-card p{margin:16px 0 0;font-size:14px;line-height:1.7;color:var(--wall-ink-soft)}
.ticket-card small{position:absolute;left:22px;right:22px;bottom:20px;border-top:1px dashed rgba(231,140,160,.5);padding-top:10px;color:var(--wall-rose-ink);font-size:10px;letter-spacing:.16em;font-weight:900}
.ar-html-card{position:absolute;inset:0;overflow:hidden;border-radius:6px;background:#fff;box-shadow:0 18px 30px -24px rgba(150,90,110,.55),inset 0 0 0 1px rgba(247,202,214,.4)}
.ar-html-frame{display:block;width:100%;height:100%;border:0;background:#fff;pointer-events:none}
.ar-wall-img-item{border-radius:6px;background:#fff;padding:7px;box-shadow:0 18px 30px -24px rgba(150,90,110,.55),inset 0 0 0 1px rgba(247,202,214,.4)}
.ar-wall-img-item img{border-radius:3px;pointer-events:none;-webkit-user-drag:none;-webkit-touch-callout:none;user-select:none}
.ar-wall-img-item.transparent{background:transparent;box-shadow:none;border-radius:0;padding:0}
.ar-wall-img-item.transparent img{border-radius:0;object-fit:contain;filter:drop-shadow(0 8px 12px rgba(180,100,120,.35))}
.ar-wall-img-item.sticker{background:transparent;box-shadow:none;border-radius:0;padding:0}
.ar-wall-img-item.sticker img{object-fit:contain;filter:drop-shadow(0 8px 12px rgba(180,100,120,.35))}
.ar-wall-note-item{overflow:visible;border-radius:10px;background:linear-gradient(165deg,#fff7e6,#fcefd2);color:#6b5638;padding:24px 18px 16px;box-shadow:0 16px 28px -22px rgba(150,110,60,.55),inset 0 0 0 1px rgba(231,196,120,.4)}
.ar-wall-note-item.char{background:linear-gradient(165deg,#fff0f4,#fbdde7);color:#7a4a57;box-shadow:0 16px 28px -22px rgba(180,100,120,.5),inset 0 0 0 1px rgba(247,202,214,.5)}
.ar-wall-note-item::before{content:'';position:absolute;left:50%;top:-9px;width:66px;height:20px;border-radius:2px;background:linear-gradient(180deg,rgba(255,255,255,.9),rgba(231,196,120,.4));box-shadow:0 5px 9px -6px rgba(120,90,40,.45);transform:translateX(-50%) rotate(-3deg)}
.ar-wall-note-item.char::before{background:linear-gradient(180deg,rgba(255,255,255,.95),rgba(247,202,214,.55))}
.ar-wall-note-item p{font-family:var(--ar-font-hand);font-size:20px;line-height:1.55;color:inherit}
.ar-wall-note-item small{left:18px;right:18px;bottom:11px;border-top:1px solid rgba(120,90,40,.15);padding-top:7px;color:rgba(120,90,40,.65);font-size:9px;font-weight:900;letter-spacing:.18em}
.ar-wall-note-item.char small{border-top-color:rgba(180,100,120,.2);color:rgba(150,80,100,.7)}
.ar-wall-text-item{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:visible;background:transparent;padding:8px;color:var(--wall-ink-strong)}
.ar-wall-text-item p{margin:0;width:100%;line-height:1.22;white-space:pre-wrap;word-break:break-word}
.ar-bond-widget{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:13px;padding:12px;background:none;box-shadow:none;color:var(--wall-ink)}
.bond-row{position:relative;z-index:1;display:flex;align-items:center;justify-content:center;gap:4px}
.bond-av{position:relative;width:82px;height:82px;border-radius:999px;padding:5px;background:#fff;box-shadow:inset 0 0 0 1px rgba(201,169,138,.75),0 0 0 1.5px rgba(201,169,138,.6),0 9px 18px -12px rgba(120,86,92,.5)}
.bond-av-inner{display:grid;place-items:center;width:100%;height:100%;overflow:hidden;border-radius:inherit;font-family:var(--ar-font-display);font-weight:500;font-size:33px;letter-spacing:.01em}
.bond-av-inner img{display:block;width:100%;height:100%;object-fit:cover}
.bond-av.you .bond-av-inner{background:linear-gradient(150deg,#f6ecec,#e9dad8);color:#9a6f77}
.bond-av.char .bond-av-inner{background:linear-gradient(150deg,#f4edf2,#e3d7df);color:#8c6574}
.bond-av-frame{position:absolute;inset:-5px;width:calc(100% + 10px);height:calc(100% + 10px);object-fit:contain;pointer-events:none}
.bond-amp{position:relative;display:inline-flex;align-items:center;justify-content:center;width:132px;height:40px;color:#d7bf92;filter:drop-shadow(0 1px 1px rgba(150,110,70,.22))}
.bond-amp svg{position:absolute;inset:0;display:block;width:100%;height:100%}
.bond-word{position:relative;z-index:1;font-family:'Tangerine','Snell Roundhand','Apple Chancery',var(--ar-font-script);font-weight:700;font-size:30px;line-height:1;padding-bottom:2px;color:#d9c49b;background:linear-gradient(160deg,#f2e5c2,#dcc59a 55%,#cbb082);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.bond-names{position:relative;z-index:1;font-family:var(--ar-font-display);font-weight:500;font-size:21px;color:var(--wall-ink-strong);letter-spacing:.05em}
.bond-since{position:relative;z-index:1;display:flex;align-items:center;gap:9px;color:#c8ad7a;font-family:'Tangerine','Snell Roundhand','Apple Chancery',var(--ar-font-script);font-size:22px;font-weight:700;line-height:1;letter-spacing:.01em;text-align:center}
.bond-since i{flex:none;width:20px;height:1px;background:linear-gradient(90deg,transparent,rgba(201,169,138,.7))}
.bond-since i:last-child{background:linear-gradient(90deg,rgba(201,169,138,.7),transparent)}
.bond-since span{min-width:0;white-space:nowrap}
.ar-pinned-remark{box-shadow:0 18px 30px -26px rgba(150,90,110,.6),inset 0 0 0 1px var(--tk-hairline)}
.ar-pinned-remark.ticket{border-radius:6px}
.ar-pinned-remark .txt{font-family:var(--ar-font-hand);font-size:17px;color:var(--wall-ink)}
.ar-note-editor{inset:8px;border:1px solid rgba(231,140,160,.4);border-radius:8px;background:rgba(255,252,253,.97);color:var(--wall-ink);font:20px/1.55 var(--ar-font-hand);padding:10px}
.ar-wall-item-menu{gap:6px;padding:6px;border:1px solid rgba(247,202,214,.7);border-radius:999px;background:rgba(255,255,255,.92);box-shadow:0 18px 38px -22px rgba(120,80,90,.7)}
.ar-wall-item-menu button{height:34px;border-color:transparent;background:transparent;color:var(--wall-ink);box-shadow:none;font-size:11px;font-weight:800}
.ar-wall-item-menu button:hover{background:var(--wall-blush-soft);color:var(--wall-rose-ink)}
.ar-wall-item-menu button[data-menu="delete"]{color:var(--wall-rose-ink)}
.ar-selection-actions{border-color:rgba(247,202,214,.7);background:rgba(255,255,255,.92);box-shadow:0 18px 38px -22px rgba(120,80,90,.7)}
.ar-selection-actions button{border-color:transparent;background:transparent;color:var(--wall-ink);font-weight:800;box-shadow:none}
.ar-selection-actions button:hover{background:var(--wall-blush-soft);color:var(--wall-rose-ink)}
.ar-selection-actions button.danger{color:var(--wall-rose-ink)}
.ar-text-style-panel{border-color:rgba(247,202,214,.65);background:rgba(255,251,250,.94);color:var(--wall-ink);box-shadow:0 28px 64px -32px rgba(120,80,90,.7),inset 0 1px 0 #fff}
.ar-text-style-head b{color:var(--wall-ink-strong)}
.ar-text-style-head small,.ar-text-range span,.ar-text-stroke,.ar-text-color-picker{color:var(--wall-ink-soft)}
.ar-text-style-head button,.ar-text-style-actions button{border-color:var(--wall-line);background:#fff6f8;color:var(--wall-rose-ink)}
.ar-text-style-actions button.on{background:linear-gradient(180deg,#fff,var(--wall-lilac));color:var(--wall-lilac-ink)}
.ar-text-color-picker,.ar-text-stroke{border-color:var(--wall-line);background:#fff}
.ar-text-color-row>button{border-color:rgba(247,202,214,.82);box-shadow:inset 0 0 0 2px rgba(255,255,255,.55),0 8px 14px -12px rgba(120,80,90,.55)}
.ar-text-color-row>button.on{outline-color:var(--wall-rose)}
.ar-asset-drawer{border:1px solid rgba(247,202,214,.6);border-radius:20px;background:rgba(255,251,250,.94);color:var(--wall-ink);box-shadow:0 28px 64px -32px rgba(120,80,90,.7),inset 0 1px 0 #fff}
.ar-asset-drawer-hd{border-bottom:1px solid var(--wall-line)}
.ar-asset-drawer-hd h3{font-family:var(--ar-font-display);font-size:16px;font-weight:600;color:var(--wall-ink-strong);letter-spacing:.02em}
.ar-asset-drawer-hd p{color:var(--wall-ink-soft);font-weight:600}
.ar-asset-upload{border-color:rgba(228,124,151,.55);background:rgba(255,255,255,.7);color:var(--wall-rose-ink)}
.ar-asset-empty{border-color:rgba(247,202,214,.65);background:#fff;color:var(--wall-ink-soft)}
.ar-asset-card{border-color:var(--wall-line);background:#fff;box-shadow:0 10px 22px -18px rgba(120,80,90,.5)}
.ar-asset-thumb{background:#fbeff2}
.ar-asset-use-chip{background:rgba(255,255,255,.86);color:var(--wall-rose-ink);box-shadow:0 8px 16px -12px rgba(120,80,90,.62)}
.ar-asset-card b{color:var(--wall-ink);font-weight:800}
.ar-asset-actions button{border-color:var(--wall-line);background:#fff6f8;color:var(--wall-rose-ink);font-weight:800}
.ar-asset-actions button.primary{border-color:transparent;background:linear-gradient(180deg,var(--wall-rose-hi),var(--wall-rose));color:#fff;box-shadow:0 10px 18px -12px rgba(228,124,151,.8)}
.ar-asset-sheet{border-color:rgba(247,202,214,.68);background:rgba(255,251,250,.96);color:var(--wall-ink);box-shadow:0 28px 64px -32px rgba(120,80,90,.72),inset 0 1px 0 #fff}
.ar-asset-sheet-preview{background:#fbeff2}
.ar-asset-sheet-copy b{color:var(--wall-ink-strong)}
.ar-asset-sheet-copy small{color:var(--wall-ink-soft)}
.ar-asset-sheet-actions button{border-color:var(--wall-line);background:#fff6f8;color:var(--wall-rose-ink)}
.ar-asset-sheet-actions button.primary{border-color:transparent;background:linear-gradient(180deg,var(--wall-rose-hi),var(--wall-rose));color:#fff;box-shadow:0 10px 18px -12px rgba(228,124,151,.8)}
.ar-asset-sheet-actions button.danger{color:var(--wall-rose-ink)}
.ar-edit-toolbar{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 14px);z-index:6;display:flex;gap:8px;max-width:calc(100% - 16px);overflow-x:auto;padding:7px;border:1px solid rgba(247,202,214,.55);border-radius:999px;background:rgba(255,255,255,.72);box-shadow:0 18px 40px -26px rgba(120,80,90,.7),inset 0 1px 0 #fff;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);scrollbar-width:none;transform:translateX(-50%)}
.ar-edit-toolbar::-webkit-scrollbar{display:none}
.ar-edit-toolbar button{flex:none;height:42px;border-radius:999px;padding:0 14px;gap:6px;font-size:12px;font-weight:800;white-space:nowrap}
.ar-edit-toolbar button:first-child{border-color:transparent;background:linear-gradient(180deg,var(--wall-rose-hi),var(--wall-rose));color:#fff;box-shadow:0 12px 22px -12px rgba(228,124,151,.85)}
.ar-edit-toolbar button:nth-child(2){border-color:rgba(167,196,160,.6);background:linear-gradient(180deg,#fff,var(--wall-sage));color:var(--wall-sage-ink)}
.ar-edit-toolbar button:nth-child(3){border-color:rgba(196,169,224,.6);background:linear-gradient(180deg,#fff,var(--wall-lilac));color:var(--wall-lilac-ink)}
.ar-edit-toolbar button[aria-label="撤销"],.ar-edit-toolbar button[aria-label="重做"]{width:42px;padding:0;color:var(--wall-rose-ink)}
.ar-edit-tools{display:flex;gap:8px}
.ar-preview-hint{position:fixed;left:50%;bottom:24px;z-index:5;display:none;transform:translateX(-50%);padding:9px 15px;border:1px solid rgba(247,202,214,.7);border-radius:999px;background:rgba(255,255,255,.88);color:var(--wall-rose-ink);font-size:12px;font-weight:800;letter-spacing:.04em;box-shadow:0 12px 26px -18px rgba(120,80,90,.6);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);pointer-events:none}
.ar-full-wall.preview .ar-preview-hint{display:inline-flex}
.ar-char-orb-wrap{position:fixed;left:0;top:0;z-index:11;width:64px;height:64px;touch-action:none;will-change:transform}
.ar-char-orb-wrap.dragging{z-index:14}
.ar-char-orb{position:relative;display:flex;align-items:center;justify-content:center;width:64px;height:64px;border:0;border-radius:999px;background:transparent;padding:0;cursor:grab;filter:drop-shadow(0 16px 18px rgba(120,74,86,.24));touch-action:none}
.ar-char-orb:active{cursor:grabbing;transform:scale(.96)}
.ar-char-orb-glow{position:absolute;inset:3px;border-radius:999px;background:radial-gradient(circle at 35% 24%,rgba(255,255,255,.9),rgba(255,219,230,.48) 42%,rgba(226,113,141,.34) 72%,rgba(226,113,141,0));box-shadow:0 0 0 1px rgba(255,255,255,.68),0 0 24px rgba(226,113,141,.28)}
.ar-char-orb.visited .ar-char-orb-glow{animation:ar-char-orb-pulse 2.4s ease-in-out infinite}
.ar-char-orb.waiting .ar-char-orb-glow{animation:ar-char-orb-pulse 1s ease-in-out infinite}
@keyframes ar-char-orb-pulse{0%,100%{transform:scale(.98);opacity:.78}50%{transform:scale(1.08);opacity:1}}
.ar-char-orb-avatar{position:relative;z-index:1;display:flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:999px;overflow:hidden;background:linear-gradient(145deg,#fff7f0,#f6dfe8);box-shadow:inset 0 0 0 2px rgba(255,255,255,.85),inset 0 -8px 14px rgba(206,116,143,.18)}
.ar-char-orb-avatar img{display:block;width:100%;height:100%;object-fit:cover;-webkit-user-drag:none;user-select:none}
.ar-char-orb-avatar b{color:var(--wall-rose-ink);font-family:var(--ar-font-display);font-size:25px}
.ar-char-orb-dot{position:absolute;right:5px;top:6px;z-index:2;width:13px;height:13px;border-radius:999px;background:linear-gradient(180deg,#fff5a8,#efbf5d);box-shadow:0 0 0 3px rgba(255,255,255,.9),0 0 16px rgba(239,191,93,.7)}
.ar-char-orb-panel{position:absolute;width:min(286px,calc(100vw - 28px));border:1px solid rgba(247,202,214,.72);border-radius:22px;background:rgba(255,255,255,.92);color:var(--wall-ink);box-shadow:0 26px 58px -30px rgba(120,80,90,.72),inset 0 1px 0 rgba(255,255,255,.95);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);padding:13px;touch-action:auto}
.ar-char-orb-panel.left{right:0}.ar-char-orb-panel.right{left:0}.ar-char-orb-panel.above{bottom:76px}.ar-char-orb-panel.below{top:76px}
.ar-char-orb-head{display:flex;align-items:center;gap:10px;min-width:0}
.ar-char-orb-mini{flex:none;display:flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:999px;overflow:hidden;background:linear-gradient(145deg,#fff7f0,#f1d9e2);box-shadow:inset 0 0 0 1px rgba(226,113,141,.16)}
.ar-char-orb-mini img{width:100%;height:100%;object-fit:cover}.ar-char-orb-mini b{font-family:var(--ar-font-display);font-size:19px;color:var(--wall-rose-ink)}
.ar-char-orb-head b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:900;color:var(--wall-ink-strong)}
.ar-char-orb-head small{display:block;margin-top:3px;font-size:10px;font-weight:800;letter-spacing:.08em;color:var(--wall-ink-soft)}
.ar-char-orb-speech{min-height:76px;margin-top:11px;border:1px solid rgba(247,202,214,.56);border-radius:16px;background:linear-gradient(180deg,rgba(255,246,248,.9),rgba(255,255,255,.76));padding:12px 13px;color:var(--wall-ink-strong);font-size:13px;line-height:1.72;white-space:pre-wrap;word-break:break-word}
.ar-char-orb-speech .muted{color:var(--wall-ink-soft)}
.ar-char-orb-speech i{display:inline-block;width:7px;height:1.2em;margin-left:2px;vertical-align:-.2em;background:var(--wall-rose);animation:ar-char-orb-caret .78s steps(1) infinite}
@keyframes ar-char-orb-caret{50%{opacity:0}}
.ar-char-orb-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:11px}
.ar-char-orb-actions button{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-width:0;height:34px;border:1px solid rgba(231,140,160,.35);border-radius:999px;background:rgba(255,255,255,.78);color:var(--wall-rose-ink);padding:0 12px;font-size:11px;font-weight:900;cursor:pointer}
.ar-char-orb-actions button.primary{flex:1 1 100%;border-color:transparent;background:linear-gradient(180deg,var(--wall-rose-hi),var(--wall-rose));color:#fff;box-shadow:0 12px 22px -14px rgba(228,124,151,.85)}
.ar-char-orb-actions button:disabled{opacity:.55;cursor:wait}
.ar-full-wall .moveable-control-box{--moveable-color:rgba(228,124,151,.95)!important}
.ar-full-wall .moveable-line{background:rgba(228,124,151,.95)!important}
.ar-full-wall .moveable-control{border:1.5px solid rgba(228,124,151,.95)!important;background:#fff!important}
.html-modal{position:fixed;inset:0;z-index:8;display:grid;place-items:center;padding:22px;background:rgba(255,246,245,.6);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.html-panel{width:min(360px,100%);max-height:calc(100dvh - 44px);display:flex;flex-direction:column;border-radius:22px;padding:18px;background:linear-gradient(180deg,#fff,#fff4f7);color:var(--wall-ink);box-shadow:0 30px 70px -36px rgba(120,80,90,.6),inset 0 0 0 1px rgba(247,202,214,.6)}
.html-panel-hd{display:flex;align-items:center;justify-content:space-between}
.html-panel-hd h3{margin:0;font-family:var(--ar-font-display);font-size:22px;font-weight:600;color:var(--wall-ink-strong)}
.html-x{width:30px;height:30px;border:1px solid rgba(228,124,151,.4);border-radius:999px;background:rgba(255,255,255,.7);color:var(--wall-rose-ink);cursor:pointer;font-size:18px;line-height:1}
.html-hint{margin:8px 0 12px;color:var(--wall-ink-soft);font-size:12px;line-height:1.6}
.html-upload{align-self:flex-start;display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 14px;border:1px solid rgba(196,169,224,.6);border-radius:999px;background:#f3eefa;color:var(--wall-lilac-ink);font-size:12px;font-weight:800;cursor:pointer}
.html-input{margin:12px 0;flex:1;min-height:168px;resize:none;border:1px solid var(--wall-line);border-radius:14px;padding:12px;background:#fffdfe;color:var(--wall-ink);font:12px/1.55 ui-monospace,Menlo,Consolas,monospace;outline:none}
.html-input:focus{border-color:rgba(228,124,151,.55)}
.html-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.html-actions button{flex:1;height:42px;border:1px solid var(--wall-line);border-radius:999px;background:rgba(255,255,255,.8);color:var(--wall-ink);font-size:13px;font-weight:800;cursor:pointer}
.html-actions button.primary{border-color:transparent;background:linear-gradient(180deg,var(--wall-rose-hi),var(--wall-rose));color:#fff;box-shadow:0 12px 22px -12px rgba(228,124,151,.8)}
.html-actions button.danger{grid-column:1 / -1;border-color:rgba(218,110,126,.36);background:#fff1f4;color:#b34d63}
.html-actions button:active,.html-upload:active,.html-x:active{transform:scale(.98)}
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
.ar-field input[readonly]{color:var(--ar-accent)}
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
.ar-editor-mini button.text{width:auto;min-width:44px;padding:0 11px}
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
.ar-remark-overlay{position:fixed;inset:0;z-index:320;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px;background:rgba(18,18,18,.45);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);animation:ar-remark-fade .24s ease both}
.ar-remark-overlay.scrolly{justify-content:flex-start;overflow-y:auto;padding:7vh 24px 12vh}
@keyframes ar-remark-fade{from{opacity:0}to{opacity:1}}
.tk-card-slot{position:relative;display:flex;align-items:center;justify-content:center;width:100%;max-width:430px}
.tk-card-slot>.active{display:block}
.tk-remark .caret{display:inline-block;width:1px;height:1em;margin-left:1px;background:currentColor;vertical-align:-.15em;animation:tk-caret .9s steps(1) infinite}
@keyframes tk-caret{50%{opacity:0}}
.tk-barcode{display:block;height:26px;background:repeating-linear-gradient(90deg,var(--tk-ink) 0 1.5px,transparent 1.5px 4px,var(--tk-ink) 4px 7px,transparent 7px 8.5px,var(--tk-ink) 8.5px 9.5px,transparent 9.5px 14px,var(--tk-ink) 14px 16px,transparent 16px 18px)}
.ar-remark-actions{display:flex;gap:10px;opacity:0;transform:translateY(8px);pointer-events:none;transition:opacity .24s ease .12s,transform .24s ease .12s}
.ar-remark-actions.show{opacity:1;transform:translateY(0);pointer-events:auto}
.ar-remark-actions button{height:42px;border-radius:999px;padding:0 22px;font-size:12px;font-weight:800;letter-spacing:.12em;text-indent:.12em;cursor:pointer}
.ar-remark-actions button:disabled{opacity:.58;cursor:wait}
.ar-remark-pin{border:1px solid var(--tk-ink);background:var(--tk-ink);color:#fff}
.ar-remark-keep{border:1px solid rgba(255,255,255,.7);background:rgba(255,255,255,.86);color:var(--tk-ink);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.ar-ticket{--py:calc(100% - 70px);position:relative;width:min(346px,92vw);border:1px solid var(--tk-hairline);border-radius:3px;background:linear-gradient(180deg,var(--tk-paper-a),var(--tk-paper-b));box-shadow:0 1px 0 rgba(255,255,255,.9) inset,0 34px 70px -30px rgba(0,0,0,.4),0 6px 16px rgba(0,0,0,.08);transform:translateY(26px) rotate(-1.6deg) scale(.97);opacity:0;transition:transform .34s cubic-bezier(.2,.9,.25,1.12),opacity .26s ease;cursor:pointer;-webkit-mask:radial-gradient(circle 9px at 0 var(--py),transparent 8px,#000 9px),radial-gradient(circle 9px at 100% var(--py),transparent 8px,#000 9px);-webkit-mask-composite:source-in;mask:radial-gradient(circle 9px at 0 var(--py),transparent 8px,#000 9px),radial-gradient(circle 9px at 100% var(--py),transparent 8px,#000 9px);mask-composite:intersect}
.ar-remark-overlay .ar-ticket.active{transform:translateY(0) rotate(-.6deg) scale(1);opacity:1}
.ar-ticket-spine{position:absolute;left:7px;top:18px;color:var(--tk-grey-lt);font-size:7px;font-weight:800;letter-spacing:.34em;writing-mode:vertical-rl;pointer-events:none;user-select:none}
.ar-ticket-body{position:relative;padding:18px 20px 20px 26px}
.ar-ticket-eyebrow,.tk-letter-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.ar-ticket-eyebrow b,.tk-letter-head b{color:var(--tk-grey);font-size:8px;font-weight:800;letter-spacing:.34em}
.ar-ticket-no,.tk-letter-head span{font-family:var(--tk-font-mono);font-size:11px;letter-spacing:.08em}
.ar-ticket-venue{margin:10px 0 0;font-size:21px;font-weight:800;line-height:1.15;color:var(--tk-ink)}
.ar-ticket-venue small{display:block;margin-top:4px;color:var(--tk-grey);font-size:8px;font-weight:800;letter-spacing:.3em}
.ar-ticket-rule,.tk-letter-rule{height:1px;margin:14px 0;background:var(--tk-hairline)}
.ar-ticket .tk-remark{min-height:96px;margin:0;color:var(--tk-ink-soft);font-family:var(--tk-font-serif);font-size:17px;line-height:1.85;white-space:pre-wrap;word-break:break-word}
.ar-ticket-seal{position:absolute;right:18px;top:58px;width:78px;height:78px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;border:2.5px solid var(--tk-stamp);border-radius:999px;color:var(--tk-stamp);transform:rotate(-12deg) scale(1.7);opacity:0;pointer-events:none;mix-blend-mode:multiply}
.ar-ticket-seal::before{content:'';position:absolute;inset:4px;border:1px dashed var(--tk-stamp);border-radius:inherit;opacity:.7}
.ar-ticket-seal em{font-style:normal;font-size:13px;font-weight:900;letter-spacing:.42em;text-indent:.42em}
.ar-ticket-seal small{font-family:var(--tk-font-mono);font-size:7px;letter-spacing:.18em}
.ar-ticket.fin .ar-ticket-seal{animation:tk-stamp .34s cubic-bezier(.2,1.1,.3,1) forwards}
@keyframes tk-stamp{0%{transform:rotate(-3deg) scale(1.7);opacity:0}62%{transform:rotate(-13deg) scale(.96);opacity:.92}100%{transform:rotate(-12deg) scale(1);opacity:.88}}
.ar-ticket-perf{height:0;border-top:1px dashed var(--tk-grey-lt);margin:0 12px}
.ar-ticket-stub{display:flex;align-items:center;justify-content:space-between;gap:14px;height:68px;padding:0 20px 0 26px}
.ar-ticket-fields{display:flex;gap:18px;min-width:0}
.ar-ticket-field{display:flex;flex-direction:column;gap:4px}
.ar-ticket-field b{color:var(--tk-grey);font-size:7px;font-weight:800;letter-spacing:.28em}
.ar-ticket-field span{font-family:var(--tk-font-mono);font-size:11px;letter-spacing:.04em;color:var(--tk-ink)}
.ar-ticket-codewrap{display:flex;flex-direction:column;align-items:flex-end;gap:3px}.ar-ticket-codewrap .tk-barcode{width:92px;height:28px}.ar-ticket-codewrap small{color:var(--tk-grey);font-family:var(--tk-font-mono);font-size:7px;letter-spacing:.3em}
.tk-pol{width:min(302px,88vw);padding:13px 13px 0;border-radius:4px;background:#fff;box-shadow:0 34px 70px -30px rgba(0,0,0,.42),0 6px 16px rgba(0,0,0,.08);transform:translateY(26px) rotate(-2deg) scale(.97);opacity:0;transition:transform .34s cubic-bezier(.2,.9,.25,1.12),opacity .26s ease;cursor:pointer}
.ar-remark-overlay .tk-pol.active{transform:translateY(0) rotate(-2deg) scale(1);opacity:1}
.tk-pol.fin{animation:tk-settle .5s ease}@keyframes tk-settle{0%{transform:rotate(-2deg)}38%{transform:rotate(-3.1deg)}72%{transform:rotate(-1.2deg)}100%{transform:rotate(-2deg)}}
.tk-pol-photo{position:relative;width:100%;aspect-ratio:1/1;overflow:hidden;background:#14161a}.tk-pol-photo img{width:100%;height:100%;object-fit:cover;filter:brightness(2.3) contrast(.55) saturate(.12) sepia(.22);transition:filter 2.4s ease}.tk-pol.dev .tk-pol-photo img{filter:none}.tk-pol-photo::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,#f3f0e9,#e8e5de);opacity:.93;transition:opacity 2.4s ease;pointer-events:none}.tk-pol.dev .tk-pol-photo::after{opacity:0}
.tk-pol-date{position:absolute;right:10px;bottom:9px;color:#ff8a3c;font-family:var(--tk-font-mono);font-size:13px;letter-spacing:.14em;text-shadow:0 0 7px rgba(255,138,60,.6);opacity:0;transition:opacity .35s ease}.tk-pol.fin .tk-pol-date{opacity:.95}
.tk-pol-cap{min-height:112px;padding:13px 4px 10px}.tk-pol .tk-remark{min-height:74px;margin:0;color:#2b2b2b;font-family:var(--tk-font-note);font-size:17px;line-height:1.75;white-space:pre-wrap;word-break:break-word}.tk-pol-meta{display:flex;justify-content:space-between;padding:8px 0 10px;color:var(--tk-grey);font-family:var(--tk-font-mono);font-size:8px;letter-spacing:.26em}
.tk-cardflip{width:min(288px,84vw);height:404px;perspective:1300px;cursor:pointer;opacity:0;transform:translateY(26px) scale(.97);transition:transform .34s cubic-bezier(.2,.9,.25,1.12),opacity .26s ease}
.ar-remark-overlay .tk-cardflip.active{opacity:1;transform:translateY(0) scale(1)}
.tk-flip{position:relative;width:100%;height:100%;transform-style:preserve-3d;transition:transform .72s cubic-bezier(.3,.8,.3,1)}.tk-cardflip.flipped .tk-flip{transform:rotateY(180deg)}
.tk-face{position:absolute;inset:0;border-radius:14px;overflow:hidden;backface-visibility:hidden;-webkit-backface-visibility:hidden;box-shadow:0 34px 70px -30px rgba(0,0,0,.5),0 6px 16px rgba(0,0,0,.1)}
.tk-face-back{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:radial-gradient(circle,rgba(255,255,255,.05) 1px,transparent 1.4px) 0 0/16px 16px,linear-gradient(165deg,#1b1b20,#121216);color:#fff}.tk-face-back::before{content:'';position:absolute;inset:12px;border:1px solid rgba(255,255,255,.2);border-radius:9px}.tk-face-back::after{content:'';position:absolute;inset:17px;border:1px solid rgba(255,255,255,.08);border-radius:7px}
.tk-back-eyebrow{color:rgba(255,255,255,.42);font-size:7px;font-weight:800;letter-spacing:.4em;text-indent:.4em}.tk-back-venue{margin:0;color:#f2f2ef;font-family:var(--tk-font-serif);font-size:24px;letter-spacing:.18em;text-indent:.18em}.tk-back-diamond{width:5px;height:5px;background:var(--tk-stamp);transform:rotate(45deg)}.tk-back-hint{position:absolute;bottom:26px;color:rgba(255,255,255,.34);font-size:8px;font-weight:800;letter-spacing:.34em;text-indent:.34em}
.tk-face-front{display:flex;flex-direction:column;background:#fbfbfa;transform:rotateY(180deg)}.tk-art{position:relative;height:55%;flex:none;overflow:hidden;background:#14161a}.tk-art img{width:100%;height:100%;object-fit:cover}.tk-art::after{content:'';position:absolute;inset:8px;border:1px solid rgba(255,255,255,.35);border-radius:6px}.tk-art-rarity{position:absolute;right:14px;top:14px;width:6px;height:6px;background:var(--tk-stamp);transform:rotate(45deg);box-shadow:0 0 0 3px rgba(255,255,255,.55)}
.tk-sheen-layer{position:absolute;inset:0;pointer-events:none;background:linear-gradient(110deg,transparent 36%,rgba(255,255,255,.55) 47%,transparent 58%);transform:translateX(-135%)}.tk-cardflip.fin .tk-sheen-layer{animation:tk-sheen .9s ease .1s forwards}@keyframes tk-sheen{to{transform:translateX(135%)}}
.tk-nameplate{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:10px 16px 0}.tk-nameplate b{font-size:14px;font-weight:900;letter-spacing:.2em;color:var(--tk-ink)}.tk-nameplate span{color:var(--tk-grey);font-size:8px;font-weight:800;letter-spacing:.3em}
.tk-cardflip .tk-remark{flex:1;min-height:0;margin:8px 16px 0;color:var(--tk-ink-soft);font-family:var(--tk-font-serif);font-size:14.5px;line-height:1.72;white-space:pre-wrap;word-break:break-word;overflow:hidden}.tk-card-foot{display:flex;justify-content:space-between;padding:8px 16px 13px;font-family:var(--tk-font-mono);font-size:9px;letter-spacing:.2em}.tk-card-foot b{color:var(--tk-stamp)}.tk-card-foot span{color:var(--tk-grey)}
.tk-letter{position:relative;width:min(362px,92vw);border:1px solid var(--tk-hairline);border-radius:3px;padding:20px 22px 16px;background:linear-gradient(180deg,rgba(0,0,0,.035) 0,transparent 1px) 0 33%/100% 1px no-repeat,linear-gradient(180deg,rgba(0,0,0,.03) 0,transparent 1px) 0 66%/100% 1px no-repeat,linear-gradient(180deg,var(--tk-paper-a),var(--tk-paper-b));box-shadow:0 1px 0 rgba(255,255,255,.9) inset,0 34px 70px -30px rgba(0,0,0,.4),0 6px 16px rgba(0,0,0,.08);transform:translateY(26px) rotate(-.6deg) scale(.98);opacity:0;transition:transform .34s cubic-bezier(.2,.9,.25,1.12),opacity .26s ease;cursor:pointer}.ar-remark-overlay .tk-letter.active{transform:translateY(0) rotate(-.6deg) scale(1);opacity:1}.tk-letter-rule{margin:12px 0 14px}
.tk-letter .tk-remark{min-height:140px;max-height:46vh;overflow-y:auto;margin:0;padding-right:4px;color:var(--tk-ink-soft);font-family:var(--tk-font-serif);font-size:16px;line-height:1.95;white-space:pre-wrap;word-break:break-word;scrollbar-width:thin}.tk-letter-seal{display:inline-block;width:20px;height:20px;margin-left:8px;border-radius:3px;background:var(--tk-stamp);color:#fff;font-family:var(--tk-font-serif);font-size:13px;font-weight:800;line-height:20px;text-align:center;vertical-align:-3px;transform:rotate(3deg) scale(1.7);opacity:0;mix-blend-mode:multiply}.tk-letter-seal.stamped{animation:tk-seal-in .3s cubic-bezier(.2,1.1,.3,1) forwards}@keyframes tk-seal-in{0%{transform:rotate(8deg) scale(1.7);opacity:0}100%{transform:rotate(3deg) scale(1);opacity:.92}}
.tk-letter-foot{margin-top:12px;text-align:right;color:var(--tk-grey);font-family:var(--tk-font-mono);font-size:8px;letter-spacing:.26em}
.tk-rcpt{position:relative;width:min(282px,84vw);padding-bottom:7px;opacity:0;transform:translateY(26px) rotate(.6deg);transition:transform .34s cubic-bezier(.2,.9,.25,1.12),opacity .26s ease;cursor:pointer;filter:drop-shadow(0 28px 50px rgba(0,0,0,.35))}.ar-remark-overlay .tk-rcpt.active{opacity:1;transform:translateY(0) rotate(.6deg)}.tk-rcpt-paper{position:relative;padding:18px 18px 14px;background:#fdfdfc}.tk-rcpt::after{content:'';position:absolute;left:0;right:0;bottom:0;height:7px;background:linear-gradient(135deg,#fdfdfc 50%,transparent 50%) 0 0/14px 14px repeat-x,linear-gradient(225deg,#fdfdfc 50%,transparent 50%) 7px 0/14px 14px repeat-x}
.tk-rcpt .ln{margin:0;color:#232323;font-family:var(--tk-font-mono);font-size:12px;line-height:1.85;letter-spacing:.05em;white-space:pre-wrap;word-break:break-all}.tk-rcpt .ln.c{text-align:center}.tk-rcpt .ln.dim{color:var(--tk-grey)}.tk-rcpt .ln.bar{padding:6px 26px 2px}.tk-rcpt .ln.bar .tk-barcode{width:100%}
.tk-rcpt-stamp{position:absolute;left:50%;top:46%;padding:7px 14px;border:2px dashed var(--tk-stamp);border-radius:6px;color:var(--tk-stamp);font-size:13px;font-weight:900;letter-spacing:.3em;text-indent:.3em;white-space:nowrap;transform:translate(-50%,-50%) rotate(-9deg) scale(1.7);opacity:0;mix-blend-mode:multiply;pointer-events:none}.tk-rcpt.fin .tk-rcpt-stamp{animation:tk-rstamp .32s cubic-bezier(.2,1.1,.3,1) forwards}@keyframes tk-rstamp{0%{transform:translate(-50%,-50%) rotate(-2deg) scale(1.7);opacity:0}100%{transform:translate(-50%,-50%) rotate(-9deg) scale(1);opacity:.9}}
.ar-toast{position:fixed;left:50%;bottom:30px;transform:translateX(-50%);z-index:300;padding:9px 17px;border-radius:999px;border:1px solid rgba(201,163,106,.38);background:#241b12;color:var(--ar-t1);font-size:12.5px;font-weight:700;letter-spacing:.02em;box-shadow:0 24px 60px -24px rgba(0,0,0,.78);animation:ar-rise .22s ease}
.ar-debug-fab{position:fixed;right:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 76px);z-index:360;display:flex;align-items:center;gap:6px;height:34px;border:1px solid rgba(201,163,106,.5);border-radius:999px;background:rgba(12,10,8,.78);color:var(--ar-accent);padding:0 12px;font-size:11px;font-weight:900;letter-spacing:.08em;box-shadow:0 14px 34px -20px rgba(0,0,0,.95);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);cursor:pointer}
.ar-debug-panel{position:fixed;left:10px;right:10px;bottom:calc(env(safe-area-inset-bottom,0px) + 10px);z-index:361;display:flex;max-height:min(72dvh,560px);flex-direction:column;overflow:hidden;border:1px solid rgba(201,163,106,.35);border-radius:18px;background:rgba(17,13,10,.94);color:var(--ar-t1);box-shadow:0 26px 80px -32px rgba(0,0,0,.95),inset 0 1px 0 rgba(255,236,210,.08);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
.ar-debug-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 12px 8px;border-bottom:1px solid rgba(255,236,210,.12)}
.ar-debug-head h3{margin:0;color:var(--ar-accent);font-size:13px;font-weight:900;letter-spacing:.08em}
.ar-debug-actions{display:flex;gap:7px;align-items:center}
.ar-debug-actions button{height:30px;border:1px solid rgba(255,236,210,.16);border-radius:999px;background:rgba(11,9,7,.72);color:var(--ar-t2);padding:0 10px;font-size:11px;font-weight:900;cursor:pointer}
.ar-debug-actions button:disabled{opacity:.45}
.ar-debug-list{flex:1;min-height:180px;overflow:auto;padding:10px 12px;font-family:ui-monospace,SFMono-Regular,Consolas,'Liberation Mono',monospace;font-size:10.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word}
.ar-debug-row{padding:7px 0;border-bottom:1px solid rgba(255,236,210,.08)}
.ar-debug-row:last-child{border-bottom:0}
.ar-debug-meta{display:block;margin-bottom:3px;color:rgba(222,202,172,.62);font-size:9px;letter-spacing:.04em}
.ar-debug-empty{padding:24px 12px;color:rgba(222,202,172,.62);text-align:center;font-size:12px}
.ar-sk-spine{flex:none;border-radius:3px 3px 1px 1px;background:linear-gradient(100deg,#241b13 38%,#32271c 50%,#241b13 62%);background-size:220% 100%;animation:ar-shimmer 1.4s ease infinite}
@keyframes ar-shimmer{from{background-position:120% 0}to{background-position:-120% 0}}
.ar-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 40px;text-align:center}
.ar-empty h2{margin:14px 0 0;font-family:var(--ar-font-display);font-weight:600;font-size:20px;letter-spacing:.1em;color:var(--ar-accent)}
.ar-empty p{margin:10px 0 0;font-size:13px;line-height:2;color:var(--ar-t3)}
@media (prefers-reduced-motion: reduce){
  .ar-exit,.ar-spine,.ar-dcard,.ar-pager,.ar-track,.ar-ebk,.ar-veil,.ar-panel,.ar-fpanel,.ar-fcand,.ar-panel-c,.ar-toast,.ar-remark-overlay,.ar-remark-actions,.ar-ticket,.tk-pol,.tk-cardflip,.tk-flip,.tk-letter,.tk-rcpt,.tk-pol-photo img,.tk-pol-photo::after{animation:none!important;transition:none!important}
  .tk-pol.fin,.ar-ticket.fin .ar-ticket-seal,.tk-cardflip.fin .tk-sheen-layer,.tk-letter-seal.stamped,.tk-rcpt.fin .tk-rcpt-stamp,.tk-remark .caret{animation:none!important}
  .ar-ticket.fin .ar-ticket-seal{transform:rotate(-12deg) scale(1);opacity:.88}.tk-letter-seal.stamped{transform:rotate(3deg) scale(1);opacity:.92}.tk-rcpt.fin .tk-rcpt-stamp{transform:translate(-50%,-50%) rotate(-9deg) scale(1);opacity:.9}
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

type CharRemarkTemplateId = 'ticket' | 'pol' | 'card' | 'letter' | 'receipt';
type CharRemarkTemplatePreference = CharRemarkTemplateId | 'auto';

const CHAR_REMARK_TEMPLATES: Record<CharRemarkTemplateId, { max: number; label: string }> = {
    ticket: { max: 60, label: '票根' },
    pol: { max: 60, label: '拍立得' },
    card: { max: 60, label: '卡牌' },
    letter: { max: 320, label: '信笺' },
    receipt: { max: Number.POSITIVE_INFINITY, label: '小票' },
};

const CHAR_REMARK_LONG_FALLBACK: Record<CharRemarkTemplateId, CharRemarkTemplateId> = {
    pol: 'letter',
    card: 'letter',
    ticket: 'letter',
    letter: 'receipt',
    receipt: 'receipt',
};

const getAutoCharRemarkTemplate = (len: number): CharRemarkTemplateId => {
    if (len <= 24) return 'ticket';
    if (len <= 44) return 'pol';
    if (len <= 60) return 'card';
    if (len <= 320) return 'letter';
    return 'receipt';
};

export function pickCharRemarkTemplate(
    text: string,
    preferred: CharRemarkTemplatePreference = 'auto',
): { pick: CharRemarkTemplateId; len: number; label: string } {
    const len = Array.from(text || '').length;
    let pick: CharRemarkTemplateId = preferred && preferred !== 'auto'
        ? preferred
        : getAutoCharRemarkTemplate(len);
    while (len > CHAR_REMARK_TEMPLATES[pick].max) {
        const next = CHAR_REMARK_LONG_FALLBACK[pick];
        if (next === pick) break;
        pick = next;
    }
    return { pick, len, label: CHAR_REMARK_TEMPLATES[pick].label };
}

const CHAR_REMARK_AVATAR_FALLBACK = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 480 480'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='%2329303c'/><stop offset='1' stop-color='%23454f60'/></linearGradient></defs><rect width='480' height='480' fill='url(%23g)'/><circle cx='240' cy='190' r='86' fill='%23e9e4d8'/><path d='M96 480c10-96 70-150 144-150s134 54 144 150z' fill='%23d7d0c0'/><circle cx='240' cy='190' r='118' fill='none' stroke='%23e9e4d8' stroke-opacity='.28' stroke-width='2'/></svg>`;

type ReceiptRemarkRow = {
    text: string;
    className?: string;
    barcode?: boolean;
};

const formatRemarkShortDate = (ts: number): string => {
    const d = new Date(ts);
    return `'${String(d.getFullYear()).slice(-2)} ${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getDate()).padStart(2, '0')}`;
};

const getCharRemarkInitial = (name: string): string => Array.from(name.trim())[0]?.toUpperCase() || 'T';

const chunkRemarkText = (text: string, size: number): string[] => {
    const chars = Array.from(text || '');
    const rows: string[] = [];
    for (let i = 0; i < chars.length; i += size) rows.push(chars.slice(i, i + size).join(''));
    return rows;
};

const buildRemarkReceiptRows = (options: {
    text: string;
    wallName: string;
    charName: string;
    date: string;
    visitNo: string;
}): ReceiptRemarkRow[] => [
    { text: 'AFTERGLOW MART', className: 'c' },
    { text: `「${options.wallName}」`, className: 'c' },
    { text: `${options.date}  №${options.visitNo}`, className: 'c dim' },
    { text: '--------------------------------', className: 'dim' },
    ...chunkRemarkText(options.text, 16).map(text => ({ text })),
    { text: '--------------------------------', className: 'dim' },
    { text: `GUEST: ${options.charName}        VISIT: ${options.visitNo}`, className: 'dim' },
    { text: '', className: 'bar', barcode: true },
    { text: '*** 谢谢光临 THANK YOU ***', className: 'c dim' },
];

function usePrefersReducedMotion(): boolean {
    const [reduced, setReduced] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
        const media = window.matchMedia('(prefers-reduced-motion: reduce)');
        const update = () => setReduced(media.matches);
        update();
        if (typeof media.addEventListener === 'function') {
            media.addEventListener('change', update);
            return () => media.removeEventListener('change', update);
        }
        media.addListener(update);
        return () => media.removeListener(update);
    }, []);

    return reduced;
}

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

export const CharRemarkPopup: React.FC<{
    remark: { wall: CollectionWall; charName: string; text: string };
    avatarUrl?: string;
    pinning: boolean;
    onClose: () => void;
    onPin: () => void;
}> = ({ remark, avatarUrl, pinning, onClose, onPin }) => {
    const reduced = usePrefersReducedMotion();
    const template = useMemo(() => pickCharRemarkTemplate(remark.text), [remark.text]);
    const openedAt = useMemo(() => Date.now(), [remark.wall.id, remark.text]);
    const wallName = remark.wall.name || '拾光墙';
    const date = fmtDate(openedAt);
    const shortDate = formatRemarkShortDate(openedAt);
    const visitNo = String(Math.max(1, (remark.wall.charRemarks?.length || 0) + 1)).padStart(2, '0');
    const charInitial = getCharRemarkInitial(remark.charName);
    const receiptRows = useMemo(() => buildRemarkReceiptRows({
        text: remark.text,
        wallName,
        charName: remark.charName,
        date,
        visitNo,
    }), [date, remark.charName, remark.text, visitNo, wallName]);
    const [visibleText, setVisibleText] = useState('');
    const [visibleReceiptRows, setVisibleReceiptRows] = useState(0);
    const [done, setDone] = useState(false);
    const [cardFlipped, setCardFlipped] = useState(template.pick !== 'card');
    const intervalRef = useRef<number | null>(null);
    const startTimerRef = useRef<number | null>(null);
    const flipTimerRef = useRef<number | null>(null);

    const clearRevealTimers = useCallback(() => {
        if (intervalRef.current !== null) {
            window.clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
        if (startTimerRef.current !== null) {
            window.clearTimeout(startTimerRef.current);
            startTimerRef.current = null;
        }
        if (flipTimerRef.current !== null) {
            window.clearTimeout(flipTimerRef.current);
            flipTimerRef.current = null;
        }
    }, []);

    const completeReveal = useCallback(() => {
        clearRevealTimers();
        setVisibleText(remark.text);
        setVisibleReceiptRows(receiptRows.length);
        setCardFlipped(true);
        setDone(true);
    }, [clearRevealTimers, receiptRows.length, remark.text]);

    useEffect(() => {
        clearRevealTimers();
        setVisibleText('');
        setVisibleReceiptRows(0);
        setDone(false);
        setCardFlipped(template.pick !== 'card');

        if (template.pick === 'card') {
            flipTimerRef.current = window.setTimeout(() => setCardFlipped(true), reduced ? 0 : 280);
        }

        startTimerRef.current = window.setTimeout(() => {
            startTimerRef.current = null;
            if (reduced) {
                completeReveal();
                return;
            }
            if (template.pick === 'receipt') {
                let index = 0;
                intervalRef.current = window.setInterval(() => {
                    index += 1;
                    setVisibleReceiptRows(index);
                    if (index >= receiptRows.length) completeReveal();
                }, 115);
                return;
            }

            const chars = Array.from(remark.text);
            if (chars.length === 0) {
                completeReveal();
                return;
            }
            const speed = Math.max(14, Math.min(36, Math.round(4200 / chars.length)));
            let index = 0;
            intervalRef.current = window.setInterval(() => {
                index += 1;
                setVisibleText(chars.slice(0, index).join(''));
                if (index >= chars.length) completeReveal();
            }, speed);
        }, template.pick === 'card' && !reduced ? 780 : 120);

        return clearRevealTimers;
    }, [clearRevealTimers, completeReveal, receiptRows.length, reduced, remark.text, template.pick]);

    const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
        if (done && event.currentTarget === event.target) onClose();
    };

    const handleCardClick = (event: React.MouseEvent<HTMLDivElement>) => {
        event.stopPropagation();
        if (!done) completeReveal();
    };

    const renderRemarkText = (withSeal = false) => (
        <>
            {visibleText}
            {!done && <span className="caret" aria-hidden="true" />}
            {withSeal && done && <span className="tk-letter-seal stamped" aria-hidden="true">{charInitial}</span>}
        </>
    );

    const classFor = (base: string, extra = '') => [
        base,
        'active',
        template.pick === 'pol' ? 'dev' : '',
        template.pick === 'card' && cardFlipped ? 'flipped' : '',
        done ? 'fin' : '',
        extra,
    ].filter(Boolean).join(' ');

    const sharedAvatar = avatarUrl || CHAR_REMARK_AVATAR_FALLBACK;

    return (
        <div
            className={`ar-remark-overlay${template.pick === 'receipt' && template.len > 140 ? ' scrolly' : ''}`}
            aria-modal="true"
            role="dialog"
            aria-label={`${remark.charName} 的留言`}
            onClick={handleOverlayClick}
        >
            <div className="tk-card-slot" onClick={handleCardClick} data-wall-name={wallName}>
                {template.pick === 'ticket' && (
                    <article className={classFor('ar-ticket')} data-theme="ticket">
                        <span className="ar-ticket-spine" aria-hidden="true">ARCHIVE OF AFTERGLOW</span>
                        <div className="ar-ticket-body">
                            <div className="ar-ticket-eyebrow"><b>VISITOR'S TICKET</b><span className="ar-ticket-no">№ {visitNo}</span></div>
                            <p className="ar-ticket-venue">{wallName}<small>LIGHT WALL · ONE VISIT</small></p>
                            <div className="ar-ticket-rule" aria-hidden="true" />
                            <p className="tk-remark">{renderRemarkText()}</p>
                            <span className="ar-ticket-seal" aria-hidden="true"><em>到访</em><small>VISITED</small></span>
                        </div>
                        <div className="ar-ticket-perf" aria-hidden="true" />
                        <div className="ar-ticket-stub">
                            <div className="ar-ticket-fields">
                                <span className="ar-ticket-field"><b>DATE</b><span>{date}</span></span>
                                <span className="ar-ticket-field"><b>GUEST</b><span>{remark.charName}</span></span>
                                <span className="ar-ticket-field"><b>VISIT</b><span>{visitNo}</span></span>
                            </div>
                            <div className="ar-ticket-codewrap"><span className="tk-barcode" aria-hidden="true" /><small>{date.replace(/\./g, ' ')} {visitNo}</small></div>
                        </div>
                    </article>
                )}

                {template.pick === 'pol' && (
                    <article className={classFor('tk-pol')} data-theme="pol">
                        <div className="tk-pol-photo">
                            <img className="tk-avatar-img" alt="角色头像" src={sharedAvatar} />
                            <span className="tk-pol-date">{shortDate}</span>
                        </div>
                        <div className="tk-pol-cap">
                            <p className="tk-remark">{renderRemarkText()}</p>
                            <div className="tk-pol-meta"><span>{wallName}</span><span>№ {visitNo}</span></div>
                        </div>
                    </article>
                )}

                {template.pick === 'card' && (
                    <article className={classFor('tk-cardflip')} data-theme="card">
                        <div className="tk-flip">
                            <div className="tk-face tk-face-back">
                                <span className="tk-back-eyebrow">ARCHIVE OF AFTERGLOW</span>
                                <p className="tk-back-venue">{wallName}</p>
                                <span className="tk-back-diamond" aria-hidden="true" />
                                <span className="tk-back-hint">TAP TO REVEAL</span>
                            </div>
                            <div className="tk-face tk-face-front">
                                <div className="tk-art">
                                    <img className="tk-avatar-img" alt="角色头像" src={sharedAvatar} />
                                    <span className="tk-art-rarity" aria-hidden="true" />
                                    <span className="tk-sheen-layer" aria-hidden="true" />
                                </div>
                                <div className="tk-nameplate"><b>{remark.charName}</b><span>VISITOR'S REMARK</span></div>
                                <p className="tk-remark">{renderRemarkText()}</p>
                                <div className="tk-card-foot"><b>VISIT {visitNo}</b><span>{date}</span></div>
                            </div>
                        </div>
                    </article>
                )}

                {template.pick === 'letter' && (
                    <article className={classFor('tk-letter')} data-theme="letter">
                        <div className="tk-letter-head"><b>A NOTE FROM {remark.charName}</b><span>{date}</span></div>
                        <div className="tk-letter-rule" aria-hidden="true" />
                        <p className="tk-remark">{renderRemarkText(true)}</p>
                        <div className="tk-letter-foot">AT {wallName} · № {visitNo}</div>
                    </article>
                )}

                {template.pick === 'receipt' && (
                    <article className={classFor('tk-rcpt')} data-theme="receipt">
                        <div className="tk-rcpt-paper">
                            <div className="tk-rcpt-lines">
                                {receiptRows.slice(0, visibleReceiptRows).map((row, index) => (
                                    <p className={`ln ${row.className || ''}`} key={`${row.text}-${index}`}>
                                        {row.barcode ? <span className="tk-barcode" aria-hidden="true" /> : row.text}
                                    </p>
                                ))}
                            </div>
                            <span className="tk-rcpt-stamp" aria-hidden="true">已到访 VISITED</span>
                        </div>
                    </article>
                )}
            </div>

            <div className={`ar-remark-actions${done ? ' show' : ''}`} onClick={(event) => event.stopPropagation()}>
                <button type="button" className="ar-remark-pin" disabled={pinning} onClick={onPin}>
                    {pinning ? '钉上中' : '钉到墙上'}
                </button>
                <button type="button" className="ar-remark-keep" onClick={onClose}>收下了</button>
            </div>
        </div>
    );
};

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

const WALL_PREVIEW_WIDTH = 375;
const WALL_PREVIEW_LIMIT = 12;
const WALL_PREVIEW_SLOT_EVENT = 'collection-wall-preview-slots';
const wallPreviewMountedIds = new Set<string>();
const WALL_CANVAS_WIDTH = 750;
const WALL_CANVAS_TOP_PADDING = 92;
const WALL_AUTO_GAP = 24;
const WALL_AUTO_SIDE_PAD = 46;
const DEFAULT_CARD_W = 330;
const DEFAULT_CARD_H = 360;
const DEFAULT_IMAGE_W = 300;
const DEFAULT_IMAGE_H = 260;
const DEFAULT_STICKER_MAX = 160;
const DEFAULT_STICKER_MIN = 64;
const DEFAULT_BOND_W = 330;
const DEFAULT_BOND_H = 168;
const DEFAULT_TEXT_W = 230;
const DEFAULT_TEXT_H = 150;
const DEFAULT_HTML_W = 300;
const DEFAULT_HTML_H = 230;
const CUSTOM_WALL_ASSET_MAX_BYTES = 10 * 1024 * 1024;
const CUSTOM_WALL_ASSET_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const TRANSPARENT_WALL_ASSET_MIME_TYPES = new Set(['image/png', 'image/webp', 'image/gif']);
const CUSTOM_WALL_FONT_MAX_BYTES = 8 * 1024 * 1024;
const CUSTOM_WALL_FONT_EXTENSIONS = new Set(['ttf', 'otf', 'woff', 'woff2']);
const CUSTOM_WALL_FONT_MIME_TYPES = new Set([
    'font/ttf',
    'font/otf',
    'font/woff',
    'font/woff2',
    'application/font-sfnt',
    'application/font-woff',
    'application/x-font-ttf',
    'application/x-font-otf',
    'application/vnd.ms-opentype',
    'application/octet-stream',
    '',
]);
const CUSTOM_WALL_HTML_MAX_CHARS = 120_000;
const WALL_TEXT_COLORS = ['#4d3438', '#76565b', '#9f4f64', '#6e5a8e', '#5e7a57', '#8a6332', '#ffffff', '#1f171a'] as const;
const DEFAULT_LIGHT_WALL_BG = 'linear-gradient(160deg,#FFF6F2,#FBE9EE 60%,#F3E6F0)';
const LEGACY_DARK_WALL_BG = '#17120e';
const DEFAULT_CUSTOM_WALL_HTML = [
    '<!doctype html>',
    '<meta charset="utf-8">',
    '<style>',
    '  html,body{margin:0;height:100%}',
    "  .c{box-sizing:border-box;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:18px;text-align:center;font-family:Georgia,'Noto Serif SC',serif;color:#7a4a57;background:linear-gradient(160deg,#fff,#ffe9ef 68%,#f6e6c9)}",
    '  .c h2{margin:0;font-size:26px;letter-spacing:.04em}',
    '  .c p{margin:0;font-size:13px;color:#a8758a;line-height:1.6}',
    '  .ring{width:30px;height:30px;border:2px solid #e79;border-right-color:transparent;border-radius:999px;animation:spin 1.6s linear infinite}',
    '  @keyframes spin{to{transform:rotate(360deg)}}',
    '</style>',
    '<div class="c"><div class="ring"></div><h2>你的卡片</h2><p>这是一张自定义 HTML 卡<br>可写任意排版 / 动效</p></div>',
].join('\n');
const WALL_BACKGROUND_SWATCHES = [
    { name: '深褐', value: '#17120e' },
    { name: '墨绿', value: '#1e2c24' },
    { name: '暖藏蓝', value: '#202636' },
    { name: '酒红', value: '#3b2028' },
    { name: '暖灰', value: '#5a5147' },
    { name: '纸白', value: '#efe7d6' },
] as const;
export const COLLECTION_WALL_CHAR_INVITE_AVATAR_KIND = 'char_invite_avatar';
const CHAR_INVITE_ORB_SIZE = 64;
const CHAR_INVITE_ORB_PAD = 14;

export const getCharInviteOrbStorageKey = (charId: string): string => `collection_wall_char_invite_orb_${charId || 'unknown'}`;

export const getDefaultCharInviteOrbPosition = (viewport: { width: number; height: number }): { x: number; y: number } => ({
    x: Math.max(CHAR_INVITE_ORB_PAD, (viewport.width || 375) - CHAR_INVITE_ORB_SIZE - CHAR_INVITE_ORB_PAD),
    y: Math.max(CHAR_INVITE_ORB_PAD, (viewport.height || 720) - CHAR_INVITE_ORB_SIZE - 112),
});

export const clampCharInviteOrbPosition = (
    position: { x: number; y: number },
    viewport: { width: number; height: number },
): { x: number; y: number } => ({
    x: Math.min(
        Math.max(CHAR_INVITE_ORB_PAD, Number(position.x) || CHAR_INVITE_ORB_PAD),
        Math.max(CHAR_INVITE_ORB_PAD, (viewport.width || 375) - CHAR_INVITE_ORB_SIZE - CHAR_INVITE_ORB_PAD),
    ),
    y: Math.min(
        Math.max(CHAR_INVITE_ORB_PAD, Number(position.y) || CHAR_INVITE_ORB_PAD),
        Math.max(CHAR_INVITE_ORB_PAD, (viewport.height || 720) - CHAR_INVITE_ORB_SIZE - CHAR_INVITE_ORB_PAD),
    ),
});

export const isCharInviteAvatarAsset = (asset: CollectionWallAsset, charId?: string): boolean => (
    asset.meta?.assetKind === COLLECTION_WALL_CHAR_INVITE_AVATAR_KIND
    && (!charId || asset.meta?.charId === charId)
);

export const getCharInviteAvatarAsset = (
    assets: CollectionWallAsset[],
    charId: string,
): CollectionWallAsset | null => (
    [...assets]
        .filter(asset => isCharInviteAvatarAsset(asset, charId))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null
);

export type WallBookEntry = {
    id: string;
    type: 'book';
    item?: CollectionWallItem;
    book: CollectionBook;
};

export type WallImageEntry = {
    id: string;
    type: 'image';
    item: CollectionWallItem;
    asset: CollectionWallAsset;
};

export type WallStickerEntry = {
    id: string;
    type: 'sticker';
    item: CollectionWallItem;
    asset: CollectionWallAsset;
};

export type WallBondEntry = {
    id: string;
    type: 'bond';
    item: CollectionWallItem;
};

export type WallHtmlEntry = {
    id: string;
    type: 'html';
    item: CollectionWallItem;
};

export type WallTextEntry = {
    id: string;
    type: 'text';
    item: CollectionWallItem;
};

export type WallZoneEntry = WallBookEntry | WallImageEntry | WallStickerEntry | WallBondEntry | WallHtmlEntry | WallTextEntry;

type CollectionWallAssetDraft = Omit<CollectionWallAsset, 'id' | 'createdAt'> & {
    id?: string;
    createdAt?: number;
};

const WALL_DECOR_PRESET_KIND = 'sully.collectionWall.decorPreset';
const WALL_DECOR_PRESET_VERSION = 1;

export type CollectionWallDecorPresetLayout = Pick<CollectionWallItem, 'x' | 'y' | 'w' | 'h' | 'rotation' | 'z' | 'order'>;

export type CollectionWallDecorPresetAsset = {
    key: string;
    mime: string;
    dataUrl: string;
    width?: number;
    height?: number;
    bytes: number;
    hash: string;
    meta?: CollectionWallAsset['meta'];
};

export type CollectionWallDecorPresetItem = {
    type: 'image' | 'sticker' | 'html' | 'text';
    layout: CollectionWallDecorPresetLayout;
    assetKey?: string;
    fontAssetKey?: string;
    html?: string;
    text?: CollectionWallItem['text'];
    name?: string;
    createdAt?: number;
};

export type CollectionWallDecorPreset = {
    kind: typeof WALL_DECOR_PRESET_KIND;
    version: typeof WALL_DECOR_PRESET_VERSION;
    exportedAt: number;
    source?: {
        wallId?: string;
        wallName?: string;
    };
    canvas: {
        width: typeof WALL_CANVAS_WIDTH;
    };
    decor: {
        background: CollectionWall['background'];
        backgroundAssetKey?: string;
        avatarFrameAssetKey?: string;
        assets: CollectionWallDecorPresetAsset[];
        items: CollectionWallDecorPresetItem[];
    };
};

const getAssetLabel = (asset: CollectionWallAsset, item?: CollectionWallItem): string => {
    const fromItem = String(item?.name || '').trim();
    const fromMeta = String(asset.meta?.name || '').trim();
    const fromPrompt = String(asset.meta?.prompt || '').trim();
    const fallback = asset.meta?.assetKind === 'font'
        ? '上传字体'
        : asset.origin === 'upload' ? '上传素材' : asset.origin === 'char' ? 'TA 添加的素材' : '聊天生成图';
    return (fromItem || fromMeta || fromPrompt || fallback).slice(0, 40);
};

export const buildWallAssetEntry = (
    item: CollectionWallItem,
    asset?: CollectionWallAsset,
): WallImageEntry | WallStickerEntry | null => {
    if (!asset || !item.assetId || (item.type !== 'image' && item.type !== 'sticker')) return null;
    return { id: item.id, type: item.type, item, asset };
};

const getTextLabel = (item: CollectionWallItem): string =>
    String(item.text?.content || item.name || '一张便签').trim().slice(0, 60);

const getHtmlCardLabel = (item: CollectionWallItem): string =>
    String(item.name || '自定义卡').trim().slice(0, 40) || '自定义卡';

const normalizeWallHtml = (value: string): string =>
    String(value || '').slice(0, CUSTOM_WALL_HTML_MAX_CHARS);

const readBlobAsDataUrl = async (blob: Blob): Promise<string> => {
    if (typeof FileReader !== 'undefined') {
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('读取资源失败'));
            reader.readAsDataURL(blob);
        });
    }
    const buffer = await blob.arrayBuffer();
    const bufferCtor = (globalThis as any).Buffer;
    if (bufferCtor) {
        return `data:${blob.type || 'application/octet-stream'};base64,${bufferCtor.from(buffer).toString('base64')}`;
    }
    throw new Error('当前环境不支持导出资源');
};

const dataUrlToBlob = (dataUrl: string): Blob => {
    const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(String(dataUrl || ''));
    if (!match) throw new Error('预设素材格式无效');
    const mime = match[1] || 'application/octet-stream';
    const payload = match[3] || '';
    const raw = match[2]
        ? (typeof atob !== 'undefined'
            ? atob(payload)
            : (globalThis as any).Buffer.from(payload, 'base64').toString('binary'))
        : decodeURIComponent(payload);
    const bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) {
        bytes[index] = raw.charCodeAt(index);
    }
    return new Blob([bytes], { type: mime });
};

const getPresetItemLayout = (item: CollectionWallItem): CollectionWallDecorPresetLayout => ({
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    rotation: item.rotation,
    z: item.z,
    order: item.order,
});

const cloneWallBackgroundForPreset = (background?: CollectionWall['background']): CollectionWall['background'] => ({
    type: background?.type || 'preset',
    value: background?.value || DEFAULT_LIGHT_WALL_BG,
    fit: background?.fit || 'cover',
    dim: Number.isFinite(Number(background?.dim)) ? Number(background?.dim) : 0,
});

export const isCollectionWallDecorPresetItem = (
    item: CollectionWallItem,
    asset?: CollectionWallAsset,
): boolean => {
    if (item.type === 'image' || item.type === 'sticker') {
        return item.author === 'user'
            && Boolean(item.assetId)
            && asset?.origin === 'upload'
            && asset.meta?.assetKind !== 'font';
    }
    if (item.type === 'html' || (item.type === 'card' && Boolean(item.html) && !item.bookId)) {
        return item.author === 'user' && Boolean(item.html);
    }
    if (item.type === 'text') {
        return item.author === 'user';
    }
    return false;
};

export const parseCollectionWallDecorPreset = (value: unknown): CollectionWallDecorPreset => {
    const preset = value as Partial<CollectionWallDecorPreset> | null;
    if (!preset || typeof preset !== 'object') throw new Error('预设文件无效');
    if (preset.kind !== WALL_DECOR_PRESET_KIND || preset.version !== WALL_DECOR_PRESET_VERSION) {
        throw new Error('不是可识别的拾光墙风格预设');
    }
    if (!preset.decor || !Array.isArray(preset.decor.assets) || !Array.isArray(preset.decor.items)) {
        throw new Error('预设内容不完整');
    }
    return preset as CollectionWallDecorPreset;
};

export async function buildCollectionWallDecorPreset(
    wall: CollectionWall,
    items: CollectionWallItem[],
    assetsById: Map<string, CollectionWallAsset>,
): Promise<CollectionWallDecorPreset> {
    const packedAssets = new Map<string, CollectionWallDecorPresetAsset>();
    const addAsset = async (asset?: CollectionWallAsset | null): Promise<string | undefined> => {
        if (!asset?.id || !asset.blob) return undefined;
        if (packedAssets.has(asset.id)) return asset.id;
        packedAssets.set(asset.id, {
            key: asset.id,
            mime: asset.mime || asset.blob.type || 'application/octet-stream',
            dataUrl: await readBlobAsDataUrl(asset.blob),
            width: asset.width,
            height: asset.height,
            bytes: asset.bytes || asset.blob.size || 0,
            hash: asset.hash,
            meta: asset.meta ? { ...asset.meta } : undefined,
        });
        return asset.id;
    };

    const background = cloneWallBackgroundForPreset(wall.background);
    const backgroundAssetKey = background.type === 'asset'
        ? await addAsset(assetsById.get(background.value))
        : undefined;
    const avatarFrameId = items.find(item => item.type === 'bond' && item.bond?.avatarFrame)?.bond?.avatarFrame;
    const avatarFrameAssetKey = avatarFrameId ? await addAsset(assetsById.get(avatarFrameId)) : undefined;
    const decorItems: CollectionWallDecorPresetItem[] = [];

    for (const source of items) {
        const asset = source.assetId ? assetsById.get(source.assetId) : undefined;
        if (!isCollectionWallDecorPresetItem(source, asset)) continue;

        const item = normalizeWallItemForCanvas(source);
        const base = {
            layout: getPresetItemLayout(item),
            name: item.name,
            createdAt: item.createdAt,
        };

        if ((item.type === 'image' || item.type === 'sticker') && asset) {
            const assetKey = await addAsset(asset);
            if (!assetKey) continue;
            decorItems.push({
                ...base,
                type: item.type,
                assetKey,
            });
            continue;
        }

        if (item.type === 'html' || (item.type === 'card' && item.html && !item.bookId)) {
            decorItems.push({
                ...base,
                type: 'html',
                html: normalizeWallHtml(item.html || ''),
            });
            continue;
        }

        if (item.type === 'text') {
            const fontAssetKey = item.text?.fontAssetId
                ? await addAsset(assetsById.get(item.text.fontAssetId))
                : undefined;
            decorItems.push({
                ...base,
                type: 'text',
                fontAssetKey,
                text: item.text ? { ...item.text } : { content: '新便签', preset: 'big_plain' },
            });
        }
    }

    return {
        kind: WALL_DECOR_PRESET_KIND,
        version: WALL_DECOR_PRESET_VERSION,
        exportedAt: Date.now(),
        source: {
            wallId: wall.id,
            wallName: wall.name,
        },
        canvas: {
            width: WALL_CANVAS_WIDTH,
        },
        decor: {
            background,
            backgroundAssetKey,
            avatarFrameAssetKey,
            assets: [...packedAssets.values()],
            items: decorItems,
        },
    };
}

export const resolveCollectionWallPresetBackground = (
    preset: CollectionWallDecorPreset,
    assetIdByKey: Map<string, string>,
    fallback: CollectionWall['background'],
): CollectionWall['background'] => {
    const background = cloneWallBackgroundForPreset(preset.decor.background);
    if (background.type !== 'asset') return background;
    const mappedAssetId = preset.decor.backgroundAssetKey
        ? assetIdByKey.get(preset.decor.backgroundAssetKey)
        : undefined;
    if (!mappedAssetId) return cloneWallBackgroundForPreset(fallback);
    return {
        ...background,
        value: mappedAssetId,
        dim: 0,
    };
};

export const createCollectionWallDecorItemsFromPreset = (
    preset: CollectionWallDecorPreset,
    assetIdByKey: Map<string, string>,
    wallId: string,
): CollectionWallItem[] => {
    const now = Date.now();
    return preset.decor.items
        .map((source, index): CollectionWallItem | null => {
            const layout: Partial<CollectionWallDecorPresetLayout> = source.layout || {};
            const base: CollectionWallItem = {
                id: createLocalItemId(),
                wallId,
                type: source.type,
                author: 'user',
                x: Number.isFinite(Number(layout.x)) ? Number(layout.x) : Math.round(WALL_CANVAS_WIDTH / 2 - DEFAULT_TEXT_W / 2),
                y: Number.isFinite(Number(layout.y)) ? Number(layout.y) : WALL_CANVAS_TOP_PADDING + index * 8,
                w: Number.isFinite(Number(layout.w)) && Number(layout.w) > 0 ? Number(layout.w) : DEFAULT_TEXT_W,
                h: Number.isFinite(Number(layout.h)) && Number(layout.h) > 0 ? Number(layout.h) : DEFAULT_TEXT_H,
                rotation: Number.isFinite(Number(layout.rotation)) ? Number(layout.rotation) : 0,
                z: Number.isFinite(Number(layout.z)) ? Number(layout.z) : index + 1,
                order: Number.isFinite(Number(layout.order)) ? Number(layout.order) : index,
                name: source.name,
                createdAt: source.createdAt || now + index,
            };

            if (source.type === 'image' || source.type === 'sticker') {
                const assetId = source.assetKey ? assetIdByKey.get(source.assetKey) : undefined;
                if (!assetId) return null;
                return normalizeWallItemForCanvas({
                    ...base,
                    type: source.type,
                    assetId,
                    name: source.name || (source.type === 'sticker' ? '导入贴纸' : '导入图片'),
                });
            }

            if (source.type === 'html') {
                const html = normalizeWallHtml(source.html || '');
                if (!html) return null;
                return normalizeWallItemForCanvas({
                    ...base,
                    type: 'html',
                    w: Number.isFinite(Number(layout.w)) && Number(layout.w) > 0 ? Number(layout.w) : DEFAULT_HTML_W,
                    h: Number.isFinite(Number(layout.h)) && Number(layout.h) > 0 ? Number(layout.h) : DEFAULT_HTML_H,
                    html,
                    name: source.name || '导入 HTML 卡',
                });
            }

            if (source.type === 'text') {
                const fontAssetId = source.fontAssetKey ? assetIdByKey.get(source.fontAssetKey) : undefined;
                return normalizeWallItemForCanvas({
                    ...base,
                    type: 'text',
                    text: {
                        content: String(source.text?.content || '新便签').slice(0, 160),
                        preset: source.text?.preset || 'big_plain',
                        color: source.text?.color,
                        stroke: source.text?.stroke,
                        fontAssetId,
                        fontFamily: fontAssetId ? source.text?.fontFamily : undefined,
                        fontSize: source.text?.fontSize,
                        align: source.text?.align,
                    },
                    name: source.name || '导入文字',
                });
            }

            return null;
        })
        .filter((item): item is CollectionWallItem => Boolean(item));
};

function useWallPreviewMountSlot<T extends HTMLElement>(id: string, ref: React.RefObject<T | null>): boolean {
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

const sanitizeWallAssetName = (value: string): string => {
    const normalized = String(value || '')
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return (normalized || '上传素材').slice(0, 40);
};

const getFileExtension = (fileName: string): string => (
    String(fileName || '').split('.').pop() || ''
).trim().toLowerCase();

const isTransparentWallAssetMime = (mime?: string): boolean =>
    TRANSPARENT_WALL_ASSET_MIME_TYPES.has(String(mime || '').toLowerCase());

export const wallAssetUsesTransparentCanvas = (asset: Pick<CollectionWallAsset, 'mime' | 'meta'>): boolean => {
    if (typeof asset.meta?.hasTransparency === 'boolean') return asset.meta.hasTransparency;
    return isTransparentWallAssetMime(asset.mime);
};

const isSupportedWallFontFile = (file: File): boolean => {
    const extension = getFileExtension(file.name);
    return CUSTOM_WALL_FONT_EXTENSIONS.has(extension) && CUSTOM_WALL_FONT_MIME_TYPES.has(file.type || '');
};

const getTextFontLabel = (asset?: CollectionWallAsset | null): string =>
    String(asset?.meta?.name || asset?.meta?.uploadedFileName || '默认字体').trim().slice(0, 32) || '默认字体';

const readImageDimensions = async (blob: Blob): Promise<{ width?: number; height?: number }> => {
    if (typeof Image === 'undefined' || typeof URL === 'undefined') return {};
    const url = URL.createObjectURL(blob);
    try {
        return await new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve({
                width: image.naturalWidth || image.width || undefined,
                height: image.naturalHeight || image.height || undefined,
            });
            image.onerror = () => reject(new Error('无法读取图片尺寸'));
            image.src = url;
        });
    } finally {
        URL.revokeObjectURL(url);
    }
};

const readImageHasTransparency = async (blob: Blob): Promise<boolean | undefined> => {
    if (
        !isTransparentWallAssetMime(blob.type)
        || typeof Image === 'undefined'
        || typeof URL === 'undefined'
        || typeof document === 'undefined'
    ) {
        return undefined;
    }

    const url = URL.createObjectURL(blob);
    try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
            const nextImage = new Image();
            nextImage.onload = () => resolve(nextImage);
            nextImage.onerror = () => reject(new Error('无法读取图片透明度'));
            nextImage.src = url;
        });
        const width = image.naturalWidth || image.width || 0;
        const height = image.naturalHeight || image.height || 0;
        if (!width || !height) return undefined;

        const maxPixels = 512 * 512;
        const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return undefined;

        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let index = 3; index < pixels.length; index += 4) {
            if (pixels[index] < 255) return true;
        }
        return false;
    } catch {
        return undefined;
    } finally {
        URL.revokeObjectURL(url);
    }
};

const buildUploadedWallAssetDraft = async (file: File): Promise<CollectionWallAssetDraft> => {
    if (!CUSTOM_WALL_ASSET_MIME_TYPES.has(file.type)) {
        throw new Error('只支持 PNG、JPG、WEBP、GIF 图片');
    }
    if (file.size > CUSTOM_WALL_ASSET_MAX_BYTES) {
        throw new Error('图片不能超过 10MB');
    }
    const buffer = await file.arrayBuffer();
    const [dimensions, hasTransparency] = await Promise.all([
        readImageDimensions(file),
        readImageHasTransparency(file),
    ]);
    const name = sanitizeWallAssetName(file.name);
    return {
        blob: file,
        mime: file.type || 'image/png',
        width: dimensions.width,
        height: dimensions.height,
        bytes: file.size,
        hash: fnv1aBytes(buffer),
        origin: 'upload',
        meta: {
            name,
            uploadedFileName: file.name,
            ...(typeof hasTransparency === 'boolean' ? { hasTransparency } : {}),
            hiddenFromLibrary: false,
        },
    };
};

const buildUploadedWallFontDraft = async (file: File): Promise<CollectionWallAssetDraft> => {
    if (!isSupportedWallFontFile(file)) {
        throw new Error('只支持 TTF、OTF、WOFF、WOFF2 字体文件');
    }
    if (file.size > CUSTOM_WALL_FONT_MAX_BYTES) {
        throw new Error('字体文件不能超过 8MB');
    }
    const buffer = await file.arrayBuffer();
    const name = sanitizeWallAssetName(file.name);
    return {
        blob: file,
        mime: file.type || `font/${getFileExtension(file.name) || 'ttf'}`,
        bytes: file.size,
        hash: fnv1aBytes(buffer),
        origin: 'upload',
        meta: {
            assetKind: 'font',
            name,
            uploadedFileName: file.name,
            hiddenFromLibrary: false,
        },
    };
};

const getFittedAssetSize = (
    asset: CollectionWallAsset,
    maxW: number,
    maxH: number,
    minW: number,
    minH: number,
    fallbackW: number,
    fallbackH: number,
): { w: number; h: number } => {
    const sourceW = typeof asset.width === 'number' && asset.width > 0 ? asset.width : fallbackW;
    const sourceH = typeof asset.height === 'number' && asset.height > 0 ? asset.height : fallbackH;
    const scale = Math.min(maxW / sourceW, maxH / sourceH, 1);
    const fittedW = Math.max(1, Math.round(sourceW * scale));
    const fittedH = Math.max(1, Math.round(sourceH * scale));
    const grow = Math.max(minW / fittedW, minH / fittedH, 1);
    return {
        w: Math.min(maxW, Math.round(fittedW * grow)),
        h: Math.min(maxH, Math.round(fittedH * grow)),
    };
};

export const getCollectionBookWallHtml = (book: CollectionBook): string =>
    String(book.meta?.html || book.cardData?.meta?.html || '').trim();

const getDefaultWallItemSize = (item: CollectionWallItem): { w: number; h: number } => {
    if (item.type === 'image') return { w: DEFAULT_IMAGE_W, h: DEFAULT_IMAGE_H };
    if (item.type === 'sticker') return { w: DEFAULT_STICKER_MAX, h: DEFAULT_STICKER_MAX };
    if (item.type === 'bond') return { w: DEFAULT_BOND_W, h: DEFAULT_BOND_H };
    if (item.type === 'text') return { w: DEFAULT_TEXT_W, h: DEFAULT_TEXT_H };
    if (item.type === 'html' || item.html) return { w: DEFAULT_HTML_W, h: DEFAULT_HTML_H };
    return { w: DEFAULT_CARD_W, h: DEFAULT_CARD_H };
};

const normalizeWallItemForCanvas = (item: CollectionWallItem): CollectionWallItem => {
    const fallback = getDefaultWallItemSize(item);
    const w = Number.isFinite(item.w) && item.w > 0 ? item.w : fallback.w;
    const h = Number.isFinite(item.h) && item.h > 0 ? item.h : fallback.h;
    const isBookCard = item.type === 'card' && !item.html;
    const shouldUseDefaultCardFrame = isBookCard && item.x == null && item.y == null && h <= 240;
    return {
        ...item,
        w: shouldUseDefaultCardFrame ? Math.max(w, DEFAULT_CARD_W) : w,
        h: shouldUseDefaultCardFrame ? DEFAULT_CARD_H : h,
        rotation: Number.isFinite(item.rotation) ? item.rotation : 0,
        z: Number.isFinite(item.z) ? item.z : 0,
        order: Number.isFinite(item.order) ? item.order : 0,
    };
};

export function autoArrangeWallItems(
    items: CollectionWallItem[],
    options: { canvasHeight?: number } = {},
): CollectionWallItem[] {
    const sortedItems = [...items]
        .sort((a, b) => (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0));
    const fixedCanvasHeight = Number(options.canvasHeight);
    if (Number.isFinite(fixedCanvasHeight) && fixedCanvasHeight > 0 && sortedItems.length > 0) {
        const count = sortedItems.length;
        const gap = count > 20 ? 14 : 18;
        const sidePad = count > 20 ? 28 : WALL_AUTO_SIDE_PAD;
        const maxColumns = count > 18 ? 4 : count > 8 ? 3 : 2;
        const columnCount = Math.min(maxColumns, Math.max(1, Math.ceil(Math.sqrt((count * WALL_CANVAS_WIDTH) / fixedCanvasHeight))));
        const rowCount = Math.max(1, Math.ceil(count / columnCount));
        const availableW = Math.max(1, WALL_CANVAS_WIDTH - sidePad * 2 - gap * (columnCount - 1));
        const availableH = Math.max(1, fixedCanvasHeight - WALL_CANVAS_TOP_PADDING - sidePad - gap * (rowCount - 1));
        const cellW = availableW / columnCount;
        const cellH = availableH / rowCount;

        return sortedItems.map((source, index) => {
            const item = normalizeWallItemForCanvas(source);
            const col = index % columnCount;
            const row = Math.floor(index / columnCount);
            const fit = Math.min(cellW / item.w, cellH / item.h, 1);
            const minW = Math.min(44, cellW);
            const minH = Math.min(44, cellH);
            const w = Math.round(Math.min(cellW, Math.max(minW, item.w * fit)));
            const h = Math.round(Math.min(cellH, Math.max(minH, item.h * fit)));
            const x = sidePad + col * (cellW + gap) + (cellW - w) / 2;
            const y = WALL_CANVAS_TOP_PADDING + row * (cellH + gap) + (cellH - h) / 2;
            const microTilt = ((hashOf(item.id || `${item.wallId}:${index}`) % 7) - 3) * 0.5;
            return {
                ...item,
                x: Math.round(x),
                y: Math.round(y),
                w,
                h,
                rotation: Number((item.rotation || microTilt || 0).toFixed(2)),
                z: item.z || index + 1,
                order: index,
            };
        });
    }

    const columnWidth = (WALL_CANVAS_WIDTH - WALL_AUTO_SIDE_PAD * 2 - WALL_AUTO_GAP) / 2;
    const columns = [WALL_CANVAS_TOP_PADDING, WALL_CANVAS_TOP_PADDING];
    return sortedItems
        .map((source, index) => {
            const item = normalizeWallItemForCanvas(source);
            const col = columns[0] <= columns[1] ? 0 : 1;
            const w = Math.min(item.w, columnWidth);
            const h = Math.max(item.h, getDefaultWallItemSize(item).h);
            const x = WALL_AUTO_SIDE_PAD + col * (columnWidth + WALL_AUTO_GAP) + (columnWidth - w) / 2;
            const y = columns[col];
            columns[col] += h + WALL_AUTO_GAP;
            const microTilt = ((hashOf(item.id || `${item.wallId}:${index}`) % 7) - 3) * 0.5;
            const arranged = {
                ...item,
                x: Math.round(x),
                y: Math.round(y),
                w: Math.round(w),
                h: Math.round(h),
                rotation: Number((item.rotation || microTilt || 0).toFixed(2)),
                z: item.z || index + 1,
                order: index,
            };
            if (!Number.isFinite(options.canvasHeight)) return arranged;
            return {
                ...arranged,
                ...normalizeWallItemFrameForCanvas(arranged, {
                    x: arranged.x,
                    y: arranged.y,
                    w: arranged.w,
                    h: arranged.h,
                    rotation: arranged.rotation,
                }, { canvasHeight: options.canvasHeight }),
            };
        });
}

export function wallItemsOverlap(a: CollectionWallItem, b: CollectionWallItem): boolean {
    if (a.x == null || a.y == null || b.x == null || b.y == null) return false;
    return a.x < b.x + b.w
        && a.x + a.w > b.x
        && a.y < b.y + b.h
        && a.y + a.h > b.y;
}

export const CollectionWallCardFrame: React.FC<{
    book: CollectionBook;
    width: number;
    height: number;
    forceMounted?: boolean;
}> = ({ book, width, height, forceMounted }) => {
    const hostRef = useRef<HTMLDivElement>(null);
    const lazyMounted = useWallPreviewMountSlot(`card-${book.id}`, hostRef);
    const mounted = typeof forceMounted === 'boolean' ? forceMounted : lazyMounted;
    const title = getCollectionDisplayTitle(book);
    const html = getCollectionBookWallHtml(book);
    const srcDoc = html ? injectFreeformCompatScript(html) : '';
    const scale = Math.max(0.2, width / WALL_PREVIEW_WIDTH);
    const frameHeight = Math.max(1, Math.ceil(height / scale));

    return (
        <div
            ref={hostRef}
            className="ar-live-card"
            data-testid="collection-wall-card-frame"
            style={{
                '--card-scale': scale,
                '--frame-h': `${frameHeight}px`,
            } as React.CSSProperties}
        >
            {!mounted && <div className="ar-live-card-placeholder">{title}</div>}
            {mounted && html && (
                <iframe
                    className="ar-live-card-frame mounted"
                    srcDoc={srcDoc}
                    sandbox="allow-scripts"
                    title={`拾光墙真渲染：${title}`}
                    data-book-id={book.id}
                />
            )}
            {mounted && !html && (
                <div className="ar-live-card-missing">未实现：这条藏品缺少 meta.html</div>
            )}
        </div>
    );
};

export const CollectionWallHtmlFrame: React.FC<{
    item: CollectionWallItem;
}> = ({ item }) => {
    const title = getHtmlCardLabel(item);
    const html = String(item.html || '').trim();
    const srcDoc = html ? injectFreeformCompatScript(html) : '';

    return (
        <div className="ar-html-card">
            {html ? (
                <iframe
                    className="ar-html-frame"
                    srcDoc={srcDoc}
                    sandbox="allow-scripts"
                    title={`拾光墙 HTML 卡：${title}`}
                    loading="lazy"
                />
            ) : (
                <div className="ticket-card">
                    <b>{title}</b>
                    <p>自由创作卡：在装修里点 HTML卡，即可粘贴或上传 HTML 渲染。</p>
                    <small>FREEFORM · WALL CARD</small>
                </div>
            )}
        </div>
    );
};

const WallImageLayer: React.FC<{ entry: WallImageEntry | WallStickerEntry }> = ({ entry }) => {
    const url = useAssetObjectUrl(entry.asset);
    const label = getAssetLabel(entry.asset, entry.item);
    const className = [
        'ar-wall-img-item',
        wallAssetUsesTransparentCanvas(entry.asset) ? 'transparent' : '',
        entry.type === 'sticker' ? 'sticker' : '',
    ].filter(Boolean).join(' ');
    return (
        <div className={className} title={label} onContextMenu={event => event.preventDefault()}>
            {url && <img src={url} alt={label} loading="lazy" draggable={false} />}
        </div>
    );
};

const BondAvatar: React.FC<{
    src?: string;
    name: string;
    role: 'you' | 'char';
    fallback?: string;
    frameUrl?: string;
}> = ({ src, name, role, fallback, frameUrl }) => {
    const initial = fallback || Array.from(name.trim())[0] || '·';
    return (
        <span className={`bond-av ${role}`}>
            <span className="bond-av-inner">
                {src ? <img src={src} alt="" /> : initial}
            </span>
            {frameUrl && <img className="bond-av-frame" src={frameUrl} alt="" aria-hidden="true" />}
        </span>
    );
};

const BondWidgetLayer: React.FC<{
    userName: string;
    userAvatar?: string;
    charName: string;
    charAvatar?: string;
    sinceAt?: number;
    avatarFrameAsset?: CollectionWallAsset | null;
}> = ({ userName, userAvatar, charName, charAvatar, sinceAt, avatarFrameAsset }) => {
    const avatarFrameUrl = useAssetObjectUrl(avatarFrameAsset || null);
    const togetherDays = Math.max(1, Math.floor((Date.now() - (sinceAt || Date.now())) / 86400000) + 1);
    return (
        <article className="ar-bond-widget" aria-label={`${userName} 和 ${charName} 的连接`}>
            <div className="bond-row">
                <BondAvatar src={userAvatar} name={userName} role="you" fallback="你" frameUrl={avatarFrameUrl} />
                <span className="bond-amp" aria-hidden="true">
                    <svg viewBox="0 0 132 40" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
                        <g stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" fill="none">
                            <path d="M3 20H33" />
                            <path d="M99 20H129" />
                            <path d="M33 20C37 15 43 15 45 20" />
                            <path d="M99 20C95 15 89 15 87 20" />
                        </g>
                        <g fill="currentColor">
                            <circle cx="4" cy="20" r="1.4" />
                            <circle cx="128" cy="20" r="1.4" />
                            <ellipse cx="38" cy="16" rx="2.8" ry="1.3" transform="rotate(-22 38 16)" />
                            <ellipse cx="94" cy="16" rx="2.8" ry="1.3" transform="rotate(22 94 16)" />
                            <circle cx="33" cy="20" r="1.1" />
                            <circle cx="99" cy="20" r="1.1" />
                        </g>
                    </svg>
                    <span className="bond-word">together</span>
                </span>
                <BondAvatar src={charAvatar} name={charName} role="char" frameUrl={avatarFrameUrl} />
            </div>
            <div className="bond-names">你 与 {charName}</div>
            <div className="bond-since"><i /><span>Through {togetherDays} dawns, still yours.</span><i /></div>
        </article>
    );
};

const CharPinnedRemarkLayer: React.FC<{
    entry: WallTextEntry;
    charName?: string;
    charAvatar?: string;
}> = ({ entry, charName = 'TA', charAvatar }) => {
    const text = String(entry.item.text?.content || entry.item.name || 'TA 的留言').trim().slice(0, 300);
    const template = (entry.item.text?.remarkTemplate || pickCharRemarkTemplate(text).pick) as CollectionWallRemarkTemplate;
    const date = fmtDate(entry.item.createdAt || Date.now());
    const shortDate = date.slice(5);
    const initial = getCharRemarkInitial(charName);
    const avatar = charAvatar || CHAR_REMARK_AVATAR_FALLBACK;
    const receiptLines = [
        'AFTERGLOW',
        shortDate,
        '----------',
        ...chunkRemarkText(text, 14).slice(0, 5),
    ];

    if (template === 'ticket') {
        return (
            <article className="ar-pinned-remark ticket" aria-label={text}>
                <div className="hd"><b>VISITOR</b><span>{shortDate}</span></div>
                <div className="txt">{text}</div>
                <div className="foot">PINNED · {charName}</div>
            </article>
        );
    }

    if (template === 'pol') {
        return (
            <article className="ar-pinned-remark pol" aria-label={text}>
                <div className="ar-pinned-pol-photo"><img src={avatar} alt="" /></div>
                <div className="txt">{text}</div>
                <div className="foot"><span>{charName}</span><span>{shortDate}</span></div>
            </article>
        );
    }

    if (template === 'card') {
        return (
            <article className="ar-pinned-remark card" aria-label={text}>
                <div className="art"><img src={avatar} alt="" /></div>
                <div className="name"><b>{charName}</b><span>REMARK</span></div>
                <div className="txt">{text}</div>
            </article>
        );
    }

    if (template === 'receipt') {
        return (
            <article className="ar-pinned-remark receipt" aria-label={text}>
                {receiptLines.map((line, index) => (
                    <p className={`ln${index < 2 ? ' c' : ''}`} key={`${line}-${index}`}>{line}</p>
                ))}
                <span className="stamp">VISITED</span>
            </article>
        );
    }

    return (
        <article className="ar-pinned-remark letter" aria-label={text}>
            <div className="hd"><b>A NOTE</b><span>{shortDate}</span></div>
            <div className="txt">{text}<span className="seal" aria-hidden="true">{initial}</span></div>
        </article>
    );
};

const WallAssetLibraryCard: React.FC<{
    asset: CollectionWallAsset;
    onUseSticker: (asset: CollectionWallAsset) => void;
    onUseImage: (asset: CollectionWallAsset) => void;
    onUseBackground: (asset: CollectionWallAsset) => void;
    onUseAvatarFrame: (asset: CollectionWallAsset) => void;
    onOpenActions: (asset: CollectionWallAsset) => void;
    onRemove: (asset: CollectionWallAsset) => void;
}> = ({ asset, onUseSticker, onUseImage, onUseBackground, onUseAvatarFrame, onOpenActions, onRemove }) => {
    const url = useAssetObjectUrl(asset);
    const label = getAssetLabel(asset);
    return (
        <article className="ar-asset-card" onContextMenu={event => event.preventDefault()}>
            <button
                type="button"
                className="ar-asset-thumb"
                onClick={() => onOpenActions(asset)}
                onContextMenu={event => event.preventDefault()}
                aria-label={`使用素材：${label}`}
            >
                {url && <img src={url} alt={label} loading="lazy" draggable={false} />}
                <span className="ar-asset-use-chip">使用</span>
            </button>
            <b title={label}>{label}</b>
            <div className="ar-asset-actions">
                <button type="button" className="wide primary" onClick={() => onUseImage(asset)}><ImageSquare weight="bold" size={12} />添加到墙上</button>
                <button type="button" onClick={() => onUseSticker(asset)}><Sticker weight="bold" size={12} />贴纸</button>
                <button type="button" onClick={() => onUseBackground(asset)}><PaintBrush weight="bold" size={12} />墙纸</button>
                <button type="button" onClick={() => onUseAvatarFrame(asset)}><ImageSquare weight="bold" size={12} />头像框</button>
                <button type="button" onClick={() => onRemove(asset)}><Trash weight="bold" size={12} />移出</button>
            </div>
        </article>
    );
};

const WallAssetActionSheet: React.FC<{
    asset: CollectionWallAsset;
    onUseImage: (asset: CollectionWallAsset) => void;
    onUseSticker: (asset: CollectionWallAsset) => void;
    onUseBackground: (asset: CollectionWallAsset) => void;
    onUseAvatarFrame: (asset: CollectionWallAsset) => void;
    onRemove: (asset: CollectionWallAsset) => void;
    onClose: () => void;
}> = ({ asset, onUseImage, onUseSticker, onUseBackground, onUseAvatarFrame, onRemove, onClose }) => {
    const url = useAssetObjectUrl(asset);
    const label = getAssetLabel(asset);
    const run = (action: (asset: CollectionWallAsset) => void) => {
        onClose();
        action(asset);
    };

    return (
        <section className="ar-asset-sheet" aria-label={`素材操作：${label}`} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
            <div className="ar-asset-sheet-preview" onContextMenu={event => event.preventDefault()}>
                {url && <img src={url} alt={label} draggable={false} />}
            </div>
            <div className="ar-asset-sheet-copy">
                <b>{label}</b>
                <small>选择素材用途</small>
            </div>
            <div className="ar-asset-sheet-actions">
                <button type="button" className="primary" onClick={() => run(onUseImage)}><ImageSquare weight="bold" size={15} />添加到墙上</button>
                <button type="button" onClick={() => run(onUseSticker)}><Sticker weight="bold" size={15} />作为贴纸</button>
                <button type="button" onClick={() => run(onUseBackground)}><PaintBrush weight="bold" size={15} />设为墙纸</button>
                <button type="button" onClick={() => run(onUseAvatarFrame)}><ImageSquare weight="bold" size={15} />设为头像框</button>
                <button type="button" className="danger" onClick={() => run(onRemove)}><Trash weight="bold" size={15} />移出素材库</button>
                <button type="button" onClick={onClose}>取消</button>
            </div>
        </section>
    );
};

const WallTextLayer: React.FC<{
    entry: WallTextEntry;
    charName?: string;
    charAvatar?: string;
    fontAsset?: CollectionWallAsset | null;
    editing: boolean;
    onCommit: (content: string) => void;
}> = ({ entry, charName, charAvatar, fontAsset, editing, onCommit }) => {
    const isCharNote = entry.item.author === 'char';
    const label = isCharNote
        ? String(entry.item.text?.content || entry.item.name || 'TA 的留言').trim().slice(0, 300)
        : getTextLabel(entry.item);
    const [draft, setDraft] = useState(label);
    const fontUrl = useAssetObjectUrl(fontAsset || null);
    const fontFaceName = `wall-text-font-${entry.item.id.replace(/[^a-z0-9_-]/gi, '-')}`;
    const textStyle: React.CSSProperties = {
        color: entry.item.text?.color || '#4d3438',
        fontSize: `${clamp(Number(entry.item.text?.fontSize) || 28, 12, 72)}px`,
        fontFamily: fontUrl
            ? `"${fontFaceName}", var(--ar-font-hand)`
            : (entry.item.text?.fontFamily || 'var(--ar-font-hand)'),
        textAlign: entry.item.text?.align || 'center',
        textShadow: entry.item.text?.stroke
            ? '0 1px 0 rgba(255,255,255,.72), 0 -1px 0 rgba(255,255,255,.72), 1px 0 0 rgba(255,255,255,.72), -1px 0 0 rgba(255,255,255,.72), 0 8px 16px rgba(120,80,90,.18)'
            : '0 8px 16px rgba(120,80,90,.16)',
    };

    useEffect(() => setDraft(label), [label]);

    if (isCharNote) {
        return (
            <>
                <CharPinnedRemarkLayer entry={entry} charName={charName} charAvatar={charAvatar} />
                {editing && (
                    <textarea
                        className="ar-note-editor"
                        autoFocus
                        value={draft}
                        maxLength={300}
                        onChange={event => setDraft(event.target.value)}
                        onBlur={() => onCommit(draft)}
                        onPointerDown={event => event.stopPropagation()}
                        onClick={event => event.stopPropagation()}
                        onKeyDown={event => {
                            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                                event.currentTarget.blur();
                            }
                        }}
                    />
                )}
            </>
        );
    }

    return (
        <article className="ar-wall-text-item" aria-label={label}>
            {fontUrl && <style>{`@font-face{font-family:"${fontFaceName}";src:url("${fontUrl}")}`}</style>}
            <p style={textStyle}>{label}</p>
            {editing && (
                <textarea
                    className="ar-note-editor"
                    autoFocus
                    value={draft}
                    maxLength={160}
                    onChange={event => setDraft(event.target.value)}
                    onBlur={() => onCommit(draft)}
                    onPointerDown={event => event.stopPropagation()}
                    onClick={event => event.stopPropagation()}
                    onKeyDown={event => {
                        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                            event.currentTarget.blur();
                        }
                    }}
                />
            )}
        </article>
    );
};

type LightWallZoneData = {
    wall: CollectionWall;
    entries: WallZoneEntry[];
};

const getWallEntryTimestamp = (entry: WallZoneEntry): number => {
    if (entry.type === 'book') return entry.book.collectedAt || entry.book.createdAt || 0;
    if (entry.type === 'image' || entry.type === 'sticker') return entry.asset.createdAt || entry.item.createdAt || 0;
    return entry.item.createdAt || 0;
};

const LightWallListCard: React.FC<{
    wall: CollectionWall;
    entries: WallZoneEntry[];
    onOpen: () => void;
}> = ({ wall, entries, onOpen }) => {
    const latest = [...entries]
        .sort((a, b) => getWallEntryTimestamp(b) - getWallEntryTimestamp(a))
        .slice(0, 2);

    return (
        <article className="ar-wall-card-wrap">
            <div className="ar-wall-card">
                <button type="button" className="ar-wall-card-main" onClick={onOpen} aria-label={`打开拾光墙「${wall.name}」`}>
                    {wall.hasUnseenCharItem && <span className="ar-wall-seen" aria-label="TA 来过" />}
                    <span className="ar-wall-card-copy">
                        <h3>{wall.name}</h3>
                        <p>{entries.length} 件</p>
                        <span className="ar-wall-teasers">
                            {latest.map(entry => (
                                <span key={entry.id} className="ar-wall-teaser">
                                    <i />
                                    <span>{getWallEntryLabel(entry)}</span>
                                </span>
                            ))}
                        </span>
                    </span>
                    <span className="ar-wall-card-count">
                        {entries.length}
                        <small>PIECES</small>
                    </span>
                </button>
            </div>
        </article>
    );
};

const LightWallShelf: React.FC<{
    zones: LightWallZoneData[];
    onOpenWall: (wall: CollectionWall, entries: WallZoneEntry[]) => void;
}> = ({ zones, onOpenWall }) => {
    if (zones.length === 0) {
        return <div className="ar-wall-empty-list">在聊天里点开一张自由创作卡，就能收进墙上。</div>;
    }

    return (
        <div className="ar-wall-list">
            {zones.map(zone => (
                <LightWallListCard
                    key={zone.wall.id}
                    wall={zone.wall}
                    entries={zone.entries}
                    onOpen={() => onOpenWall(zone.wall, zone.entries)}
                />
            ))}
        </div>
    );
};

type WallDraftSnapshot = {
    wall: CollectionWall;
    items: CollectionWallItem[];
};

type PersistedWallDraftSnapshot = {
    wall: CollectionWall;
    items: CollectionWallItem[];
};

type CollectionWallPersistWriter = (
    wall: CollectionWall,
    items: CollectionWallItem[],
) => Promise<PersistedWallDraftSnapshot>;

export function createCollectionWallPersistQueue(writeSnapshot: CollectionWallPersistWriter) {
    let latestToken = 0;
    let chain: Promise<PersistedWallDraftSnapshot> | null = null;

    return {
        nextToken() {
            latestToken += 1;
            return latestToken;
        },
        isCurrent(token: number) {
            return token === latestToken;
        },
        enqueue(wall: CollectionWall, items: CollectionWallItem[], token: number, force = false) {
            const fallback = { wall, items };
            const previous = chain || Promise.resolve(fallback);
            const task = previous
                .catch(() => fallback)
                .then(async () => {
                    if (!force && token !== latestToken) return fallback;
                    return writeSnapshot(wall, items);
                });
            chain = task;
            return task;
        },
    };
}

type WallScreenState = {
    wall: CollectionWall;
    entries: WallZoneEntry[];
    charName: string;
};

function cloneWallSnapshot(wall: CollectionWall, items: CollectionWallItem[]): WallDraftSnapshot {
    return {
        wall: {
            ...wall,
            background: { ...wall.background },
        },
        items: items.map(item => ({
            ...item,
            text: item.text ? { ...item.text } : undefined,
            bond: item.bond ? { ...item.bond } : undefined,
        })),
    };
}

const debugWallDraftHead = (phase: string, wallId: string, items: CollectionWallItem[]): void => {
    console.info(`[CollectionWallDebug] ${phase}`, {
        wallId,
        itemCount: items.length,
        head: items.slice(0, 8).map((item, index) => ({
            index,
            id: item.id,
            order: item.order,
            z: item.z,
            x: item.x,
            y: item.y,
        })),
    });
};

export function buildDefaultBondWidgetItem(wall: CollectionWall, order = 0, z = 1): CollectionWallItem {
    return normalizeWallItemForCanvas({
        id: `wall-bond-${wall.id}`,
        wallId: wall.id,
        type: 'bond',
        author: 'user',
        x: Math.round((WALL_CANVAS_WIDTH - DEFAULT_BOND_W) / 2),
        y: 30,
        w: DEFAULT_BOND_W,
        h: DEFAULT_BOND_H,
        rotation: 0,
        z,
        order,
        bond: { variant: 'default' },
        name: '头像连接',
        createdAt: wall.createdAt || Date.now(),
    });
}

export function buildInitialWallItems(wall: CollectionWall, entries: WallZoneEntry[]): CollectionWallItem[] {
    const realItems = entries
        .map(entry => entry.item)
        .filter((item): item is CollectionWallItem => Boolean(item))
        .map(normalizeWallItemForCanvas);

    const hasBondWidget = realItems.some(item => item.type === 'bond');
    if (!hasBondWidget && !wall.defaultBondWidgetHidden && !wall.id.startsWith('fallback-')) {
        realItems.unshift(buildDefaultBondWidgetItem(
            wall,
            0,
            realItems.reduce((max, item) => Math.max(max, item.z || 0), 0) + 1,
        ));
    }

    const looseItems = entries
        .filter((entry): entry is WallBookEntry => entry.type === 'book' && !entry.item)
        .map((entry, index): CollectionWallItem => normalizeWallItemForCanvas({
            id: `loose-${entry.book.id}`,
            wallId: wall.id,
            type: 'card',
            author: 'user',
            x: null,
            y: null,
            w: DEFAULT_CARD_W,
            h: DEFAULT_CARD_H,
            rotation: 0,
            z: realItems.length + index + 1,
            order: realItems.length + index,
            bookId: entry.book.id,
            name: getCollectionDisplayTitle(entry.book),
            createdAt: entry.book.collectedAt || entry.book.createdAt || Date.now(),
        }));

    if (realItems.some(item => item.x != null && item.y != null)) {
        return preserveFreeLayoutItemOrder([...realItems, ...looseItems]);
    }

    if (wall.id.startsWith('fallback-') && looseItems.length > 0) {
        return autoArrangeWallItems(looseItems);
    }

    return preserveFreeLayoutItemOrder([...realItems, ...looseItems]);
}

type WallEntriesBuildResult = {
    entries: WallZoneEntry[];
    wallBookIds: Set<string>;
};

type CollectionHallLoadSnapshot = {
    books: CollectionBook[];
    walls: CollectionWall[];
    wallItems: CollectionWallItem[];
    wallAssets: CollectionWallAsset[];
};

export const buildWallZoneEntriesFromItems = (
    wall: CollectionWall,
    wallItems: CollectionWallItem[],
    books: CollectionBook[],
    wallAssets: CollectionWallAsset[],
): WallEntriesBuildResult => {
    const bookById = new Map(books.map(book => [book.id, book]));
    const assetById = new Map(wallAssets.map(asset => [asset.id, asset]));
    const wallBookIds = new Set<string>();
    const entries = wallItems
        .filter(item => item.wallId === wall.id)
        .sort(compareWallItemsStable)
        .reduce<WallZoneEntry[]>((acc, item) => {
            if (item.type === 'html' || (item.type === 'card' && item.html && !item.bookId)) {
                if (item.html) acc.push({ id: item.id, type: 'html', item });
                return acc;
            }
            if (item.type === 'card' && item.bookId) {
                const book = bookById.get(item.bookId);
                if (book?.kind !== 'freeform') return acc;
                wallBookIds.add(book.id);
                acc.push({ id: item.id, type: 'book', item, book });
                return acc;
            }
            if ((item.type === 'image' || item.type === 'sticker') && item.assetId) {
                const entry = buildWallAssetEntry(item, assetById.get(item.assetId));
                if (entry) acc.push(entry);
                return acc;
            }
            if (item.type === 'bond') {
                acc.push({ id: item.id, type: 'bond', item });
                return acc;
            }
            if (item.type === 'text' && item.text?.content) {
                acc.push({ id: item.id, type: 'text', item });
                return acc;
            }
            return acc;
        }, []);
    return { entries, wallBookIds };
};

const useViewportSize = () => {
    const read = () => ({
        width: typeof window === 'undefined' ? WALL_CANVAS_WIDTH : window.innerWidth || WALL_CANVAS_WIDTH,
        height: typeof window === 'undefined' ? 800 : window.innerHeight || 800,
    });
    const [size, setSize] = useState(read);
    useEffect(() => {
        const update = () => setSize(read());
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
    }, []);
    return size;
};

type CharWallOrbReply = {
    wall: CollectionWall;
    entries: WallZoneEntry[];
    charName: string;
    text: string;
};

export const CharInviteOrb: React.FC<{
    wall: CollectionWall;
    entries: WallZoneEntry[];
    charName: string;
    charAvatar?: string;
    inviteAvatarAsset?: CollectionWallAsset | null;
    inviting: boolean;
    uploading: boolean;
    pinning: boolean;
    onRequestRemark: (trigger: CollectionWallVisitTrigger) => Promise<CharWallOrbReply | null>;
    onUploadAvatar: (file: File) => Promise<void>;
    onPinRemark: (reply: CharWallOrbReply) => Promise<void>;
}> = ({
    wall,
    entries,
    charName,
    charAvatar,
    inviteAvatarAsset,
    inviting,
    uploading,
    pinning,
    onRequestRemark,
    onUploadAvatar,
    onPinRemark,
}) => {
    const viewport = useViewportSize();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragRef = useRef<{
        pointerId: number;
        startX: number;
        startY: number;
        originX: number;
        originY: number;
        moved: boolean;
    } | null>(null);
    const storageKey = getCharInviteOrbStorageKey(wall.charId);
    const inviteAvatarUrl = useAssetObjectUrl(inviteAvatarAsset || null);
    const latestSavedRemark = useMemo(() => {
        const remarks = wall.charRemarks || [];
        return String(remarks[remarks.length - 1]?.text || '').trim();
    }, [wall.charRemarks]);
    const [panelOpen, setPanelOpen] = useState(false);
    const [position, setPosition] = useState(() => {
        const fallback = getDefaultCharInviteOrbPosition(viewport);
        try {
            const stored = JSON.parse(localStorage.getItem(storageKey) || 'null');
            if (stored && typeof stored.x === 'number' && typeof stored.y === 'number') {
                return clampCharInviteOrbPosition(stored, viewport);
            }
        } catch {
            // ignore malformed localStorage
        }
        return clampCharInviteOrbPosition(fallback, viewport);
    });
    const [replyText, setReplyText] = useState(latestSavedRemark);
    const [visibleReply, setVisibleReply] = useState(latestSavedRemark);
    const [typing, setTyping] = useState(false);
    const [localVisited, setLocalVisited] = useState(false);
    const [dragging, setDragging] = useState(false);

    const hasVisited = localVisited || Boolean(wall.charLastVisitAt || latestSavedRemark || replyText);
    const canPin = Boolean(replyText.trim()) && !typing && !inviting;
    const panelSide = position.x < viewport.width / 2 ? 'right' : 'left';
    const panelVertical = position.y < 230 ? 'below' : 'above';
    const avatarFallback = charName.trim().slice(0, 1) || 'T';
    const avatarSrc = inviteAvatarUrl || charAvatar || '';

    useEffect(() => {
        const next = clampCharInviteOrbPosition(position, viewport);
        if (next.x !== position.x || next.y !== position.y) {
            setPosition(next);
        }
    }, [position, viewport]);

    useEffect(() => {
        const fallback = getDefaultCharInviteOrbPosition(viewport);
        try {
            const stored = JSON.parse(localStorage.getItem(storageKey) || 'null');
            setPosition(clampCharInviteOrbPosition(
                stored && typeof stored.x === 'number' && typeof stored.y === 'number' ? stored : fallback,
                viewport,
            ));
        } catch {
            setPosition(clampCharInviteOrbPosition(fallback, viewport));
        }
        setPanelOpen(false);
        setLocalVisited(false);
    }, [storageKey]);

    useEffect(() => {
        if (!latestSavedRemark) return;
        setReplyText(latestSavedRemark);
    }, [latestSavedRemark]);

    useEffect(() => {
        if (!replyText.trim()) {
            setVisibleReply('');
            setTyping(false);
            return undefined;
        }
        const chars = Array.from(replyText);
        let index = 0;
        setVisibleReply('');
        setTyping(true);
        const speed = Math.max(18, Math.min(42, Math.round(3600 / Math.max(chars.length, 1))));
        const timer = window.setInterval(() => {
            index += 1;
            setVisibleReply(chars.slice(0, index).join(''));
            if (index >= chars.length) {
                window.clearInterval(timer);
                setTyping(false);
            }
        }, speed);
        return () => window.clearInterval(timer);
    }, [replyText]);

    const savePosition = useCallback((nextPosition: { x: number; y: number }) => {
        try {
            localStorage.setItem(storageKey, JSON.stringify(nextPosition));
        } catch {
            // best effort only
        }
    }, [storageKey]);

    const handlePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: position.x,
            originY: position.y,
            moved: false,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
    }, [position]);

    const handlePointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (Math.abs(dx) + Math.abs(dy) > 5) {
            drag.moved = true;
            setDragging(true);
            setPanelOpen(false);
        }
        if (!drag.moved) return;
        setPosition(clampCharInviteOrbPosition({ x: drag.originX + dx, y: drag.originY + dy }, viewport));
    }, [viewport]);

    const handlePointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        dragRef.current = null;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        const next = clampCharInviteOrbPosition(position, viewport);
        setPosition(next);
        if (drag.moved) {
            savePosition(next);
            window.setTimeout(() => setDragging(false), 0);
            return;
        }
        setDragging(false);
        setPanelOpen(prev => !prev);
    }, [position, savePosition, viewport]);

    const requestRemark = useCallback(async () => {
        const trigger: CollectionWallVisitTrigger = hasVisited ? 'poke' : 'invite';
        const result = await onRequestRemark(trigger);
        if (!result) return;
        setLocalVisited(true);
        setReplyText(result.text);
        setPanelOpen(true);
    }, [hasVisited, onRequestRemark]);

    const handleUploadChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (!file) return;
        await onUploadAvatar(file);
    }, [onUploadAvatar]);

    const handlePin = useCallback(async () => {
        const text = replyText.trim();
        if (!text) return;
        await onPinRemark({ wall, entries, charName, text });
    }, [charName, entries, onPinRemark, replyText, wall]);

    return (
        <div
            className={`ar-char-orb-wrap${panelOpen ? ' open' : ''}${dragging ? ' dragging' : ''}`}
            style={{ transform: `translate3d(${position.x}px,${position.y}px,0)` }}
            onClick={event => event.stopPropagation()}
        >
            <button
                type="button"
                className={`ar-char-orb${hasVisited ? ' visited' : ''}${inviting ? ' waiting' : ''}`}
                aria-label={`${charName} 的拾光墙邀请球`}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={() => {
                    dragRef.current = null;
                    setDragging(false);
                }}
            >
                <span className="ar-char-orb-glow" aria-hidden="true" />
                <span className="ar-char-orb-avatar">
                    {avatarSrc ? <img src={avatarSrc} alt="" draggable={false} /> : <b>{avatarFallback}</b>}
                </span>
                {hasVisited && <span className="ar-char-orb-dot" aria-hidden="true" />}
            </button>
            {panelOpen && (
                <section className={`ar-char-orb-panel ${panelSide} ${panelVertical}`} aria-label={`${charName} 的观墙回应`}>
                    <div className="ar-char-orb-head">
                        <span className="ar-char-orb-mini">
                            {avatarSrc ? <img src={avatarSrc} alt="" draggable={false} /> : <b>{avatarFallback}</b>}
                        </span>
                        <span>
                            <b>{charName}</b>
                            <small>{hasVisited ? '正在墙前陪你看' : '还在门口等你邀请'}</small>
                        </span>
                    </div>
                    <div className={`ar-char-orb-speech${typing ? ' typing' : ''}`}>
                        {inviting ? (
                            <span className="muted">他正在看这面墙...</span>
                        ) : visibleReply ? (
                            <>
                                {visibleReply}
                                {typing && <i aria-hidden="true" />}
                            </>
                        ) : (
                            <span className="muted">邀请他来之后，就能戳一戳听他说。</span>
                        )}
                    </div>
                    <div className="ar-char-orb-actions">
                        <button type="button" className="primary" disabled={inviting} onClick={requestRemark}>
                            <PaperPlaneTilt weight="bold" size={14} />{inviting ? '听他说...' : hasVisited ? '戳一戳，听听他说' : '邀请他来'}
                        </button>
                        <button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                            <UploadSimple weight="bold" size={14} />{uploading ? '处理中' : '更换小人'}
                        </button>
                        {canPin && (
                            <button type="button" disabled={pinning} onClick={handlePin}>
                                <Check weight="bold" size={14} />{pinning ? '钉上去...' : '钉到墙上'}
                            </button>
                        )}
                    </div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        hidden
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        onChange={handleUploadChange}
                    />
                </section>
            )}
        </div>
    );
};

const FullScreenLightWall: React.FC<{
    wall: CollectionWall;
    entries: WallZoneEntry[];
    libraryAssets: CollectionWallAsset[];
    userName: string;
    userAvatar?: string;
    charName: string;
    charAvatar?: string;
    inviting: boolean;
    pinningRemark: boolean;
    onClose: () => void;
    onPickBook: (book: CollectionBook) => void;
    onPickImage: (entry: WallImageEntry, wallName: string) => void;
    onInviteChar: (wall: CollectionWall, entries: WallZoneEntry[], charName: string, trigger: CollectionWallVisitTrigger) => Promise<CharWallOrbReply | null>;
    onPinCharRemark: (reply: CharWallOrbReply) => Promise<void>;
    onSaved: () => Promise<unknown> | void;
    onAssetsChanged: () => Promise<unknown> | void;
    say: (message: string) => void;
}> = ({ wall, entries, libraryAssets, userName, userAvatar, charName, charAvatar, inviting, pinningRemark, onClose, onPickBook, onPickImage, onInviteChar, onPinCharRemark, onSaved, onAssetsChanged, say }) => {
    const viewport = useViewportSize();
    const scale = Math.max(0.2, viewport.width / WALL_CANVAS_WIDTH);
    const canvasRef = useRef<HTMLDivElement>(null);
    const assetFileInputRef = useRef<HTMLInputElement>(null);
    const textFontInputRef = useRef<HTMLInputElement>(null);
    const htmlFileInputRef = useRef<HTMLInputElement>(null);
    const decorPresetFileInputRef = useRef<HTMLInputElement>(null);
    const saveTimerRef = useRef<number | null>(null);
    const transientDraftFrameRef = useRef<number | null>(null);
    const pendingTransientItemsRef = useRef<CollectionWallItem[] | null>(null);
    const persistWriterRef = useRef<CollectionWallPersistWriter>(async (nextWall, nextItems) => ({ wall: nextWall, items: nextItems }));
    const persistQueueRef = useRef(createCollectionWallPersistQueue((nextWall, nextItems) => persistWriterRef.current(nextWall, nextItems)));
    const itemRefs = useRef(new Map<string, HTMLDivElement>());
    const longPressTimerRef = useRef<number | null>(null);
    const editStartSnapshotRef = useRef<WallDraftSnapshot | null>(null);
    const [draftWall, setDraftWall] = useState<CollectionWall>(() => ({ ...wall, layoutMode: 'free' }));
    const [draftItems, setDraftItems] = useState<CollectionWallItem[]>(() => buildInitialWallItems(wall, entries));
    const [editing, setEditing] = useState(false);
    const [preview, setPreview] = useState(false);
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
    const [selectedTarget, setSelectedTarget] = useState<HTMLElement | null>(null);
    const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null);
    const [editingTextId, setEditingTextId] = useState<string | null>(null);
    const [htmlEditor, setHtmlEditor] = useState<{ itemId?: string; draft: string } | null>(null);
    const [libraryOpen, setLibraryOpen] = useState(false);
    const [activeAssetActions, setActiveAssetActions] = useState<CollectionWallAsset | null>(null);
    const [actionMenuOpen, setActionMenuOpen] = useState(false);
    const [toolboxOpen, setToolboxOpen] = useState(false);
    const [uploadingAsset, setUploadingAsset] = useState(false);
    const [uploadingInviteAvatar, setUploadingInviteAvatar] = useState(false);
    const [uploadingFont, setUploadingFont] = useState(false);
    const [importingPreset, setImportingPreset] = useState(false);
    const [savingWallDraft, setSavingWallDraft] = useState(false);
    const [past, setPast] = useState<WallDraftSnapshot[]>([]);
    const [future, setFuture] = useState<WallDraftSnapshot[]>([]);
    const latestDraftRef = useRef<WallDraftSnapshot>(cloneWallSnapshot(draftWall, draftItems));

    const entryByItemId = useMemo(() => new Map(entries.filter(entry => Boolean(entry.item)).map(entry => [entry.item!.id, entry])), [entries]);
    const bookById = useMemo(() => new Map(entries.filter((entry): entry is WallBookEntry => entry.type === 'book').map(entry => [entry.book.id, entry.book])), [entries]);
    const assetById = useMemo(() => {
        const map = new Map(libraryAssets.map(asset => [asset.id, asset]));
        entries.forEach((entry) => {
            if (entry.type === 'image' || entry.type === 'sticker') {
                map.set(entry.asset.id, entry.asset);
            }
        });
        return map;
    }, [entries, libraryAssets]);
    const customLibraryAssets = useMemo(() => (
        libraryAssets
            .filter(asset => (
                asset.origin === 'upload'
                && asset.meta?.assetKind !== 'font'
                && asset.meta?.assetKind !== COLLECTION_WALL_CHAR_INVITE_AVATAR_KIND
                && !asset.meta?.hiddenFromLibrary
            ))
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    ), [libraryAssets]);
    const selectedItem = useMemo(() => (
        selectedItemId ? draftItems.find(item => item.id === selectedItemId) || null : null
    ), [draftItems, selectedItemId]);
    const selectedUserTextItem = selectedItem?.type === 'text' && selectedItem.author === 'user' ? selectedItem : null;
    const selectedTextFontAsset = selectedUserTextItem?.text?.fontAssetId
        ? assetById.get(selectedUserTextItem.text.fontAssetId) || null
        : null;
    const backgroundAsset = draftWall.background?.type === 'asset'
        ? assetById.get(draftWall.background.value) || null
        : null;
    const backgroundAssetUrl = useAssetObjectUrl(backgroundAsset);
    const wallBackgroundEffects = getWallBackgroundEffects(draftWall.background);
    const isLegacyDefaultWallBackground = draftWall.background?.type !== 'asset'
        && String(draftWall.background?.value || '').trim().toLowerCase() === LEGACY_DARK_WALL_BG;
    const renderedWallBackgroundEffects = isLegacyDefaultWallBackground
        ? { dim: 0.02, noiseOpacity: 0.03 }
        : wallBackgroundEffects;
    const wallBackgroundValue = backgroundAssetUrl
        ? `url("${backgroundAssetUrl}") center / ${draftWall.background.fit === 'tile' ? 'auto repeat' : 'cover no-repeat'}`
        : isLegacyDefaultWallBackground ? DEFAULT_LIGHT_WALL_BG : draftWall.background.value || DEFAULT_LIGHT_WALL_BG;
    const canPersist = !wall.id.startsWith('fallback-');
    const inviteAvatarAsset = useMemo(() => getCharInviteAvatarAsset(libraryAssets, wall.charId), [libraryAssets, wall.charId]);

    useEffect(() => {
        const nextItems = buildInitialWallItems(wall, entries);
        const nextWall = { ...wall, layoutMode: 'free' as const };
        latestDraftRef.current = cloneWallSnapshot(nextWall, nextItems);
        setDraftWall(nextWall);
        setDraftItems(nextItems);
        setEditing(false);
        setPreview(false);
        setSelectedItemId(null);
        setMenuPoint(null);
        setEditingTextId(null);
        setHtmlEditor(null);
        setLibraryOpen(false);
        setActiveAssetActions(null);
        setActionMenuOpen(false);
        setToolboxOpen(false);
        setUploadingInviteAvatar(false);
        setImportingPreset(false);
        setSavingWallDraft(false);
        setPast([]);
        setFuture([]);
        editStartSnapshotRef.current = null;
    }, [entries, wall]);

    useLayoutEffect(() => {
        setSelectedTarget(selectedItemId ? itemRefs.current.get(selectedItemId) || null : null);
    }, [draftItems, editing, selectedItemId]);

    useEffect(() => {
        if (!wall.hasUnseenCharItem || wall.id.startsWith('fallback-')) return;
        void (async () => {
            const latestWall = await DB.getCollectionWallById(wall.id);
            await DB.saveCollectionWall({
                ...(latestWall || wall),
                layoutMode: 'free',
                hasUnseenCharItem: false,
                charLastVisitAt: Date.now(),
            });
            await onSaved();
        })().catch(error => {
            console.error('[CollectionHall] clear wall unseen failed:', error);
        });
    }, [onSaved, wall]);

    useEffect(() => () => {
        if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
        if (longPressTimerRef.current != null) window.clearTimeout(longPressTimerRef.current);
        if (transientDraftFrameRef.current != null) window.cancelAnimationFrame(transientDraftFrameRef.current);
    }, []);

    const visibleItems = useMemo(() => draftItems.filter(item => item.x != null && item.y != null), [draftItems]);
    const trayItems = useMemo(() => draftItems.filter(item => item.x == null), [draftItems]);
    const canvasHeight = useMemo(() => getViewportWallCanvasHeight(viewport.height, scale), [scale, viewport.height]);

    const getEntryForItem = useCallback((item: CollectionWallItem): WallZoneEntry | null => {
        const existing = entryByItemId.get(item.id);
        if (existing) return existing;
        if (item.type === 'html' || (item.type === 'card' && item.html && !item.bookId)) {
            return { id: item.id, type: 'html', item };
        }
        if (item.type === 'card' && item.bookId) {
            const book = bookById.get(item.bookId);
            return book ? { id: item.id, type: 'book', item, book } : null;
        }
        if (item.type === 'image' || item.type === 'sticker') return buildWallAssetEntry(item, assetById.get(item.assetId || ''));
        if (item.type === 'bond') return { id: item.id, type: 'bond', item };
        if (item.type === 'text') return { id: item.id, type: 'text', item };
        return null;
    }, [assetById, bookById, entryByItemId]);

    const buildPersistableWall = useCallback((nextWall: CollectionWall): CollectionWall => ({
        ...nextWall,
        layoutMode: 'free',
        updatedAt: Date.now(),
        background: {
            ...nextWall.background,
            dim: nextWall.background.type === 'asset' ? 0 : clamp(Number(nextWall.background.dim) || 0, 0, 0.6),
        },
    }), []);

    const persistDraft = useCallback((
        nextWall: CollectionWall,
        nextItems: CollectionWallItem[],
        token: number,
        force = false,
    ): Promise<PersistedWallDraftSnapshot> => {
        const normalizedItems = normalizeWallDraftItemsForSave(nextItems);
        const normalizedWall = buildPersistableWall(nextWall);
        persistWriterRef.current = async (snapshotWall, snapshotItems) => {
            if (!canPersist) return { wall: snapshotWall, items: snapshotItems };
            const realItems = getPersistableWallItems(snapshotItems);
            const result = await DB.replaceCollectionWallSnapshot(snapshotWall, realItems.map(item => ({ ...item, wallId: snapshotWall.id })));
            return { wall: result.wall, items: snapshotItems };
        };
        return persistQueueRef.current.enqueue(normalizedWall, normalizedItems, token, force);
    }, [buildPersistableWall, canPersist]);

    const schedulePersist = useCallback((nextWall: CollectionWall, nextItems: CollectionWallItem[]) => {
        if (!canPersist) return;
        if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
        const token = persistQueueRef.current.nextToken();
        saveTimerRef.current = window.setTimeout(() => {
            saveTimerRef.current = null;
            if (!persistQueueRef.current.isCurrent(token)) return;
            void persistDraft(nextWall, nextItems, token).catch(error => {
                console.error('[CollectionHall] autosave wall failed:', error);
                say('自动保存失败，可以点完成重试');
            });
        }, 800);
    }, [canPersist, persistDraft, say]);

    const pushHistory = useCallback((currentWall: CollectionWall, currentItems: CollectionWallItem[]) => {
        setPast(prev => [...prev.slice(-49), cloneWallSnapshot(currentWall, currentItems)]);
        setFuture([]);
    }, []);

    const applyDraft = useCallback((nextItems: CollectionWallItem[], nextWall = latestDraftRef.current.wall) => {
        const current = latestDraftRef.current;
        pushHistory(current.wall, current.items);
        latestDraftRef.current = cloneWallSnapshot(nextWall, nextItems);
        setDraftWall(nextWall);
        setDraftItems(nextItems);
        schedulePersist(nextWall, nextItems);
    }, [pushHistory, schedulePersist]);

    const cancelTransientDraftFrame = useCallback(() => {
        pendingTransientItemsRef.current = null;
        if (transientDraftFrameRef.current != null) {
            window.cancelAnimationFrame(transientDraftFrameRef.current);
            transientDraftFrameRef.current = null;
        }
    }, []);

    const previewTransientItemFrame = useCallback((id: string, patch: WallItemFramePatch) => {
        const current = latestDraftRef.current;
        const nextItems = current.items.map(item => item.id === id
            ? normalizeWallItemForCanvas({
                ...item,
                ...patch,
                ...normalizeWallItemFrameForCanvas(item, patch, { canvasHeight }),
            })
            : item);
        pendingTransientItemsRef.current = nextItems;
        if (transientDraftFrameRef.current != null) return;
        transientDraftFrameRef.current = window.requestAnimationFrame(() => {
            transientDraftFrameRef.current = null;
            const pending = pendingTransientItemsRef.current;
            pendingTransientItemsRef.current = null;
            if (pending) setDraftItems(pending);
        });
    }, [canvasHeight]);

    const enterEditing = useCallback(() => {
        if (!canPersist) {
            say('这面临时墙不能装修');
            return;
        }
        if (!editStartSnapshotRef.current) {
            const current = latestDraftRef.current;
            editStartSnapshotRef.current = cloneWallSnapshot(current.wall, current.items);
        }
        setEditing(true);
        setPreview(false);
        setActionMenuOpen(false);
        setToolboxOpen(false);
    }, [canPersist, say]);

    const flushPersistSnapshot = useCallback(async (nextWall: CollectionWall, nextItems: CollectionWallItem[]) => {
        if (saveTimerRef.current != null) {
            window.clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }
        const token = persistQueueRef.current.nextToken();
        const saved = await persistDraft(nextWall, nextItems, token, true);
        latestDraftRef.current = cloneWallSnapshot(saved.wall, saved.items);
        setDraftWall(saved.wall);
        setDraftItems(saved.items);
        return saved;
    }, [persistDraft]);

    const flushPersist = useCallback(async () => {
        const latest = latestDraftRef.current;
        return flushPersistSnapshot(latest.wall, latest.items);
    }, [flushPersistSnapshot]);

    const finishEditing = useCallback(async () => {
        if (savingWallDraft) return;
        setSavingWallDraft(true);
        try {
            const saved = await flushPersist();
            addCollectionWallPendingContext(wall.charId, `用户最近在「${saved.wall.name}」装修了拾光墙，墙上现在有 ${saved.items.length} 件内容。下次对话可自然提及，不要刻意。`);
            editStartSnapshotRef.current = cloneWallSnapshot(saved.wall, saved.items);
            setPast([]);
            setFuture([]);
            setSelectedItemId(null);
            setMenuPoint(null);
            setEditingTextId(null);
            setHtmlEditor(null);
            setLibraryOpen(false);
            setActiveAssetActions(null);
            setToolboxOpen(false);
            await onSaved();
            setEditing(false);
            say('拾光墙已保存');
        } catch (error) {
            console.error('[CollectionHall] finish wall edit failed:', error);
            say('保存失败，稍后再试');
        } finally {
            setSavingWallDraft(false);
        }
    }, [flushPersist, onSaved, savingWallDraft, say, wall.charId]);

    const handleUploadLibraryAsset = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (!file || uploadingAsset) return;
        setUploadingAsset(true);
        try {
            const draft = await buildUploadedWallAssetDraft(file);
            const existingAssets = await DB.getCollectionWallAssetsByHash(draft.hash);
            const existingUpload = existingAssets.find(asset => asset.origin === 'upload');
            if (existingUpload) {
                await DB.saveCollectionWallAsset({
                    ...existingUpload,
                    meta: {
                        ...(existingUpload.meta || {}),
                        name: existingUpload.meta?.name || draft.meta?.name,
                        uploadedFileName: existingUpload.meta?.uploadedFileName || file.name,
                        hiddenFromLibrary: false,
                    },
                });
                say('素材已在库中');
            } else {
                await DB.saveCollectionWallAsset(draft);
                say('已加入素材库');
            }
            await onAssetsChanged();
        } catch (error: any) {
            console.error('[CollectionHall] custom asset upload failed:', error);
            say(error?.message || '上传失败，稍后再试');
        } finally {
            setUploadingAsset(false);
        }
    }, [onAssetsChanged, say, uploadingAsset]);

    const handleUploadInviteAvatar = useCallback(async (file: File) => {
        if (uploadingInviteAvatar) return;
        setUploadingInviteAvatar(true);
        try {
            const draft = await buildUploadedWallAssetDraft(file);
            const latestAssets = await DB.getAllCollectionWallAssets();
            const existing = getCharInviteAvatarAsset(latestAssets, wall.charId);
            await DB.saveCollectionWallAsset({
                id: existing?.id,
                createdAt: existing?.createdAt,
                ...draft,
                meta: {
                    ...(draft.meta || {}),
                    assetKind: COLLECTION_WALL_CHAR_INVITE_AVATAR_KIND,
                    charId: wall.charId,
                    name: `${charName || 'TA'} 的Q版小人`,
                    uploadedFileName: file.name,
                    hiddenFromLibrary: true,
                },
            });
            await onAssetsChanged();
            say('小人换好了');
        } catch (error: any) {
            console.error('[CollectionHall] invite avatar upload failed:', error);
            say(error?.message || '上传失败，稍后再试');
        } finally {
            setUploadingInviteAvatar(false);
        }
    }, [charName, onAssetsChanged, say, uploadingInviteAvatar, wall.charId]);

    const addAssetToWall = useCallback((asset: CollectionWallAsset, itemType: 'image' | 'sticker') => {
        const current = latestDraftRef.current;
        const now = Date.now();
        const size = itemType === 'sticker'
            ? getFittedAssetSize(asset, DEFAULT_STICKER_MAX, DEFAULT_STICKER_MAX, DEFAULT_STICKER_MIN, DEFAULT_STICKER_MIN, DEFAULT_STICKER_MAX, DEFAULT_STICKER_MAX)
            : getFittedAssetSize(asset, 320, 240, 140, 100, 320, 240);
        const y = Math.max(WALL_CANVAS_TOP_PADDING, Math.round((viewport.height / scale) * 0.42 - size.h / 2));
        const rotation = itemType === 'sticker' ? ((hashOf(asset.id + now) % 9) - 4) * 0.35 : 0;
        const item: CollectionWallItem = {
            id: createLocalItemId(),
            wallId: wall.id,
            type: itemType,
            author: 'user',
            x: Math.round(WALL_CANVAS_WIDTH / 2 - size.w / 2),
            y,
            w: size.w,
            h: size.h,
            rotation,
            z: current.items.reduce((max, candidate) => Math.max(max, candidate.z || 0), 0) + 1,
            order: current.items.length,
            assetId: asset.id,
            name: getAssetLabel(asset),
            createdAt: now,
        };
        const normalizedItem = {
            ...item,
            ...normalizeWallItemFrameForCanvas(item, {
                x: item.x,
                y: item.y,
                w: item.w,
                h: item.h,
                rotation,
            }, { canvasHeight }),
        };
        applyDraft(relabelItems([...current.items, normalizedItem]), current.wall);
        setSelectedItemId(item.id);
        setLibraryOpen(false);
        setActiveAssetActions(null);
        say(itemType === 'sticker' ? '贴纸已放到墙上' : '图片已放到墙上');
    }, [applyDraft, canvasHeight, scale, say, viewport.height, wall.id]);

    const handleSetAssetBackground = useCallback((asset: CollectionWallAsset) => {
        const current = latestDraftRef.current;
        applyDraft(current.items, {
            ...current.wall,
            background: {
                type: 'asset',
                value: asset.id,
                fit: 'cover',
                dim: 0,
            },
        });
        setLibraryOpen(false);
        setActiveAssetActions(null);
        say('已设为墙纸');
    }, [applyDraft, say]);

    const handleSetAvatarFrame = useCallback((asset: CollectionWallAsset) => {
        const current = latestDraftRef.current;
        const selectedBondItem = selectedItemId
            ? current.items.find(item => item.id === selectedItemId && item.type === 'bond')
            : undefined;
        const existingBondItem = selectedBondItem || current.items.find(item => item.type === 'bond');
        const maxZ = current.items.reduce((max, candidate) => Math.max(max, candidate.z || 0), 0);
        const bondItem = existingBondItem || buildDefaultBondWidgetItem(current.wall, current.items.length, maxZ + 1);
        const targetId = bondItem.id;
        const nextItems = (existingBondItem ? current.items : [bondItem, ...current.items]).map(item => (
            item.id === targetId
                ? normalizeWallItemForCanvas({
                    ...item,
                    name: item.name || '头像连接',
                    bond: {
                        ...(item.bond || {}),
                        variant: 'default',
                        avatarFrame: asset.id,
                    },
                })
                : item
        ));
        applyDraft(relabelItems(nextItems), { ...current.wall, defaultBondWidgetHidden: false });
        setSelectedItemId(targetId);
        setLibraryOpen(false);
        setActiveAssetActions(null);
        say('已设为头像框');
    }, [applyDraft, say, selectedItemId]);

    const handleRemoveLibraryAsset = useCallback(async (asset: CollectionWallAsset) => {
        if (uploadingAsset) return;
        setUploadingAsset(true);
        try {
            await flushPersist();
            const result = await DB.deleteCollectionWallAsset(asset.id);
            await onAssetsChanged();
            setActiveAssetActions(null);
            say(result === 'hidden' ? '已从素材库移出，墙上已使用的会保留' : '已从素材库移除');
        } catch (error) {
            console.error('[CollectionHall] remove custom asset failed:', error);
            say('移出素材失败，稍后再试');
        } finally {
            setUploadingAsset(false);
        }
    }, [flushPersist, onAssetsChanged, say, uploadingAsset]);

    const cancelEditing = useCallback(async () => {
        if (savingWallDraft) {
            say('正在保存...');
            return;
        }
        const snapshot = editStartSnapshotRef.current;
        if (!snapshot) {
            setEditing(false);
            setHtmlEditor(null);
            setLibraryOpen(false);
            setActiveAssetActions(null);
            setToolboxOpen(false);
            return;
        }
        if (saveTimerRef.current != null) {
            window.clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }
        setSavingWallDraft(true);
        try {
            const restored = await flushPersistSnapshot(snapshot.wall, snapshot.items);
            setDraftWall(restored.wall);
            setDraftItems(restored.items);
            setPast([]);
            setFuture([]);
            setEditing(false);
            setSelectedItemId(null);
            setMenuPoint(null);
            setEditingTextId(null);
            setHtmlEditor(null);
            setLibraryOpen(false);
            setActiveAssetActions(null);
            setToolboxOpen(false);
            await onSaved();
            say('已回到装修前');
        } catch (error) {
            console.error('[CollectionHall] cancel wall edit failed:', error);
            say('回滚失败，请稍后再试');
        } finally {
            setSavingWallDraft(false);
        }
    }, [flushPersistSnapshot, onSaved, savingWallDraft, say]);

    const handleWallExit = useCallback(() => {
        if (savingWallDraft) {
            say('正在保存...');
            return;
        }
        if (editing) {
            void cancelEditing();
            return;
        }
        onClose();
    }, [cancelEditing, editing, onClose, savingWallDraft, say]);

    const undo = useCallback(() => {
        const previous = past[past.length - 1];
        if (!previous) return;
        const current = cloneWallSnapshot(latestDraftRef.current.wall, latestDraftRef.current.items);
        const nextPast = past.slice(0, -1);
        setPast(nextPast);
        setFuture(prev => [current, ...prev].slice(0, 50));
        latestDraftRef.current = cloneWallSnapshot(previous.wall, previous.items);
        setDraftWall(previous.wall);
        setDraftItems(previous.items);
        schedulePersist(previous.wall, previous.items);
    }, [past, schedulePersist]);

    const redo = useCallback(() => {
        const next = future[0];
        if (!next) return;
        const current = cloneWallSnapshot(latestDraftRef.current.wall, latestDraftRef.current.items);
        setFuture(prev => prev.slice(1));
        setPast(prev => [...prev.slice(-49), current]);
        latestDraftRef.current = cloneWallSnapshot(next.wall, next.items);
        setDraftWall(next.wall);
        setDraftItems(next.items);
        schedulePersist(next.wall, next.items);
    }, [future, schedulePersist]);

    const arrangeAll = useCallback(() => {
        const current = latestDraftRef.current;
        debugWallDraftHead('draft-auto-arrange-before', current.wall.id, current.items);
        const arrangedItems = relabelItems(materializePlacedLooseWallItems(autoArrangeWallItems(current.items, { canvasHeight })));
        debugWallDraftHead('draft-auto-arrange-after', current.wall.id, arrangedItems);
        applyDraft(arrangedItems, current.wall);
        setSelectedItemId(null);
        setMenuPoint(null);
    }, [applyDraft, canvasHeight]);

    const updateItem = useCallback((id: string, patch: Partial<CollectionWallItem>) => {
        const current = latestDraftRef.current;
        const nextItems = current.items.map(item => item.id === id
            ? normalizeWallItemForCanvas({
                ...item,
                ...patch,
                ...normalizeWallItemFrameForCanvas(item, patch, { canvasHeight }),
            })
            : item);
        applyDraft(nextItems, current.wall);
    }, [applyDraft, canvasHeight]);

    const updateTextStyle = useCallback((id: string, patch: Partial<NonNullable<CollectionWallItem['text']>>) => {
        const source = latestDraftRef.current.items.find(item => item.id === id);
        if (!source || source.type !== 'text') return;
        updateItem(id, {
            text: {
                content: source.text?.content || '新便签',
                preset: source.text?.preset || 'big_plain',
                ...source.text,
                ...patch,
            },
        });
    }, [updateItem]);

    const handleUploadTextFont = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        const targetId = selectedUserTextItem?.id;
        if (!file || !targetId || uploadingFont) return;
        setUploadingFont(true);
        try {
            const draft = await buildUploadedWallFontDraft(file);
            const existingAssets = await DB.getCollectionWallAssetsByHash(draft.hash);
            const existingFont = existingAssets.find(asset => asset.origin === 'upload' && asset.meta?.assetKind === 'font');
            const asset = existingFont
                ? await DB.saveCollectionWallAsset({
                    ...existingFont,
                    meta: {
                        ...(existingFont.meta || {}),
                        assetKind: 'font',
                        name: existingFont.meta?.name || draft.meta?.name,
                        uploadedFileName: existingFont.meta?.uploadedFileName || file.name,
                        hiddenFromLibrary: false,
                    },
                })
                : await DB.saveCollectionWallAsset(draft);
            updateTextStyle(targetId, {
                fontAssetId: asset.id,
                fontFamily: `"${getTextFontLabel(asset)}", var(--ar-font-hand)`,
            });
            await onAssetsChanged();
            say('字体已应用到文字便签');
        } catch (error: any) {
            console.error('[CollectionHall] text font upload failed:', error);
            say(error?.message || '字体上传失败，稍后再试');
        } finally {
            setUploadingFont(false);
        }
    }, [onAssetsChanged, say, selectedUserTextItem?.id, updateTextStyle, uploadingFont]);

    const handleExportDecorPreset = useCallback(async () => {
        if (!canPersist) {
            say('这面临时墙不能导出预设');
            return;
        }
        try {
            const current = latestDraftRef.current;
            const preset = await buildCollectionWallDecorPreset(current.wall, current.items, assetById);
            const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            const safeWallName = String(current.wall.name || 'lightwall')
                .replace(/[\\/:*?"<>|]+/g, '-')
                .replace(/\s+/g, '-')
                .slice(0, 32) || 'lightwall';
            link.href = url;
            link.download = `sully-lightwall-style-${safeWallName}-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 800);
            say(`已导出风格预设：${preset.decor.items.length} 件装饰`);
        } catch (error: any) {
            console.error('[CollectionHall] export decor preset failed:', error);
            say(error?.message || '导出预设失败，稍后再试');
        }
    }, [assetById, canPersist, say]);

    const handleImportDecorPresetFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (!file || importingPreset) return;
        if (!canPersist) {
            say('这面临时墙不能导入预设');
            return;
        }

        setImportingPreset(true);
        try {
            const preset = parseCollectionWallDecorPreset(JSON.parse(await file.text()));
            const assetIdByKey = new Map<string, string>();

            for (const packed of preset.decor.assets) {
                if (!packed?.key || !packed.dataUrl) continue;
                const blob = dataUrlToBlob(packed.dataUrl);
                const buffer = await blob.arrayBuffer();
                const hash = packed.hash || fnv1aBytes(buffer);
                const meta = { ...(packed.meta || {}) };
                const assetKind = meta.assetKind || 'image';
                const existingAssets = await DB.getCollectionWallAssetsByHash(hash);
                const existingUpload = existingAssets.find(asset => (
                    asset.origin === 'upload'
                    && (asset.meta?.assetKind || 'image') === assetKind
                ));
                const dimensions: { width?: number; height?: number } = packed.width || packed.height
                    ? { width: packed.width, height: packed.height }
                    : assetKind === 'font' ? {} : await readImageDimensions(blob).catch(() => ({}));
                const asset = existingUpload
                    ? await DB.saveCollectionWallAsset({
                        ...existingUpload,
                        meta: {
                            ...(existingUpload.meta || {}),
                            ...meta,
                            name: existingUpload.meta?.name || meta.name || '导入素材',
                            uploadedFileName: existingUpload.meta?.uploadedFileName || meta.uploadedFileName,
                            hiddenFromLibrary: false,
                        },
                    })
                    : await DB.saveCollectionWallAsset({
                        blob,
                        mime: packed.mime || blob.type || 'application/octet-stream',
                        width: dimensions.width,
                        height: dimensions.height,
                        bytes: packed.bytes || blob.size,
                        hash,
                        origin: 'upload',
                        meta: {
                            ...meta,
                            name: meta.name || (assetKind === 'font' ? '导入字体' : '导入素材'),
                            hiddenFromLibrary: false,
                        },
                    });
                assetIdByKey.set(packed.key, asset.id);
            }

            const importedDecorItems = createCollectionWallDecorItemsFromPreset(preset, assetIdByKey, wall.id);
            const current = latestDraftRef.current;
            const nextBackground = resolveCollectionWallPresetBackground(preset, assetIdByKey, current.wall.background);
            const avatarFrameAssetId = preset.decor.avatarFrameAssetKey
                ? assetIdByKey.get(preset.decor.avatarFrameAssetKey)
                : undefined;
            const keptItems = current.items
                .filter(item => !isCollectionWallDecorPresetItem(item, item.assetId ? assetById.get(item.assetId) : undefined))
                .map(item => item.type === 'bond'
                    ? normalizeWallItemForCanvas({
                        ...item,
                        bond: {
                            ...(item.bond || {}),
                            variant: 'default',
                            avatarFrame: avatarFrameAssetId,
                        },
                    })
                    : item);
            const nextItems = relabelItems([...keptItems, ...importedDecorItems]);
            applyDraft(nextItems, {
                ...current.wall,
                background: nextBackground,
            });
            setSelectedItemId(null);
            setMenuPoint(null);
            setEditingTextId(null);
            setHtmlEditor(null);
            setLibraryOpen(false);
            setActiveAssetActions(null);
            await onAssetsChanged();
            say(`已导入风格预设：${importedDecorItems.length} 件装饰`);
        } catch (error: any) {
            console.error('[CollectionHall] import decor preset failed:', error);
            say(error?.message || '导入预设失败，请检查文件');
        } finally {
            setImportingPreset(false);
        }
    }, [applyDraft, assetById, canPersist, importingPreset, onAssetsChanged, say, wall.id]);

    const openHtmlEditor = useCallback((id?: string) => {
        if (!editing) enterEditing();
        const item = id ? latestDraftRef.current.items.find(candidate => candidate.id === id) : undefined;
        setHtmlEditor({
            itemId: id,
            draft: normalizeWallHtml(item?.html || DEFAULT_CUSTOM_WALL_HTML),
        });
        if (id) setSelectedItemId(id);
        setMenuPoint(null);
        setLibraryOpen(false);
    }, [editing, enterEditing]);

    const handleHtmlFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (!file) return;
        if (file.size > CUSTOM_WALL_HTML_MAX_CHARS * 2) {
            say('HTML 文件太大了，先控制在 120KB 左右');
            return;
        }
        try {
            const text = await file.text();
            setHtmlEditor(prev => prev ? { ...prev, draft: normalizeWallHtml(text) } : prev);
            say('已读取 HTML 文件');
        } catch (error) {
            console.error('[CollectionHall] read html file failed:', error);
            say('读取 HTML 文件失败');
        }
    }, [say]);

    const commitHtmlCard = useCallback(() => {
        if (!htmlEditor) return;
        const html = normalizeWallHtml(htmlEditor.draft.trim());
        if (!html) {
            say('先粘贴或上传一段 HTML');
            return;
        }
        const now = Date.now();
        if (htmlEditor.itemId) {
            const item = latestDraftRef.current.items.find(candidate => candidate.id === htmlEditor.itemId);
            if (!item) return;
            updateItem(item.id, {
                type: 'html',
                bookId: undefined,
                html,
                name: item.name || '自定义卡',
            });
            setSelectedItemId(item.id);
            say('HTML 卡已更新');
        } else {
            const current = latestDraftRef.current;
            const item: CollectionWallItem = {
                id: createLocalItemId(),
                wallId: wall.id,
                type: 'html',
                author: 'user',
                x: Math.round(WALL_CANVAS_WIDTH / 2 - DEFAULT_HTML_W / 2),
                y: Math.max(WALL_CANVAS_TOP_PADDING, Math.round((viewport.height / scale) * 0.42 - DEFAULT_HTML_H / 2)),
                w: DEFAULT_HTML_W,
                h: DEFAULT_HTML_H,
                rotation: ((hashOf(String(now)) % 7) - 3) * 0.35,
                z: current.items.reduce((max, candidate) => Math.max(max, candidate.z || 0), 0) + 1,
                order: current.items.length,
                html,
                name: '自定义卡',
                createdAt: now,
            };
            const normalizedItem = {
                ...item,
                ...normalizeWallItemFrameForCanvas(item, {
                    x: item.x,
                    y: item.y,
                    w: item.w,
                    h: item.h,
                    rotation: item.rotation,
                }, { canvasHeight }),
            };
            applyDraft(relabelItems([...current.items, normalizedItem]), current.wall);
            setSelectedItemId(item.id);
            say('已插入 HTML 卡');
        }
        setHtmlEditor(null);
    }, [applyDraft, canvasHeight, htmlEditor, scale, say, updateItem, viewport.height, wall.id]);

    const deleteItem = useCallback((id: string) => {
        const current = latestDraftRef.current;
        const deleted = current.items.find(item => item.id === id);
        const nextItems = relabelItems(current.items.filter(item => item.id !== id));
        const nextWall = deleted?.type === 'bond'
            ? { ...current.wall, defaultBondWidgetHidden: true }
            : current.wall;
        applyDraft(nextItems, nextWall);
        setSelectedItemId(null);
        setMenuPoint(null);
        if (editingTextId === id) setEditingTextId(null);
        if (htmlEditor?.itemId === id) setHtmlEditor(null);
    }, [applyDraft, editingTextId, htmlEditor?.itemId]);

    const requestDeleteItem = useCallback((id: string, message?: string) => {
        const item = latestDraftRef.current.items.find(candidate => candidate.id === id);
        const label = item ? getEditorItemLabel(item, entryByItemId) : '这件内容';
        const confirmed = window.confirm(message || `确定从拾光墙移除「${label}」吗？`);
        if (!confirmed) return false;
        deleteItem(id);
        return true;
    }, [deleteItem, entryByItemId]);

    const renameItem = useCallback((id: string) => {
        const item = latestDraftRef.current.items.find(candidate => candidate.id === id);
        if (!item) return;
        const nextName = window.prompt('给这件墙上物起名', item.name || getEditorItemLabel(item, entryByItemId));
        if (nextName == null) return;
        updateItem(id, { name: nextName.replace(/\s+/g, ' ').trim().slice(0, 32) || undefined });
    }, [entryByItemId, updateItem]);

    const editSelectedItem = useCallback((id: string) => {
        const item = latestDraftRef.current.items.find(candidate => candidate.id === id);
        if (!item) return;
        setMenuPoint(null);
        if (item.type === 'text') {
            setEditingTextId(id);
            return;
        }
        if (item.type === 'html' || (item.type === 'card' && item.html && !item.bookId)) {
            openHtmlEditor(id);
            return;
        }
        renameItem(id);
    }, [openHtmlEditor, renameItem]);

    const bringToFront = useCallback((id: string) => {
        const maxZ = latestDraftRef.current.items.reduce((max, item) => Math.max(max, item.z || 0), 0);
        updateItem(id, { z: maxZ + 1 });
        setMenuPoint(null);
    }, [updateItem]);

    const sendToBack = useCallback((id: string) => {
        const minZ = latestDraftRef.current.items.reduce((min, item) => Math.min(min, item.z || 0), 0);
        updateItem(id, { z: minZ - 1 });
        setMenuPoint(null);
    }, [updateItem]);

    const rotateItemBy = useCallback((id: string, delta: number) => {
        const item = latestDraftRef.current.items.find(candidate => candidate.id === id);
        if (!item) return;
        updateItem(id, { rotation: Number(((item.rotation || 0) + delta).toFixed(2)) });
        setMenuPoint(null);
    }, [updateItem]);

    const screenToCanvas = useCallback((clientX: number, clientY: number) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return { x: 0, y: 0 };
        return clientPointToWallCanvasPoint(clientX, clientY, rect, scale);
    }, [scale]);

    const addTextAt = useCallback((clientX: number, clientY: number) => {
        const current = latestDraftRef.current;
        const point = screenToCanvas(clientX, clientY);
        const now = Date.now();
        const item: CollectionWallItem = {
            id: createLocalItemId(),
            wallId: wall.id,
            type: 'text',
            author: 'user',
            x: Math.round(point.x - DEFAULT_TEXT_W / 2),
            y: Math.max(0, Math.round(point.y - DEFAULT_TEXT_H / 2)),
            w: DEFAULT_TEXT_W,
            h: DEFAULT_TEXT_H,
            rotation: ((hashOf(String(now)) % 7) - 3) * 0.5,
            z: current.items.reduce((max, item) => Math.max(max, item.z || 0), 0) + 1,
            order: current.items.length,
            text: {
                content: '新便签',
                preset: 'big_plain',
                color: '#4d3438',
                fontSize: 28,
                align: 'center',
            },
            name: '文字便签',
            createdAt: now,
        };
        const normalizedItem = {
            ...item,
            ...normalizeWallItemFrameForCanvas(item, {
                x: item.x,
                y: item.y,
                w: item.w,
                h: item.h,
                rotation: item.rotation,
            }, { canvasHeight }),
        };
        applyDraft(relabelItems([...current.items, normalizedItem]), current.wall);
        setSelectedItemId(item.id);
        setEditingTextId(item.id);
    }, [applyDraft, canvasHeight, screenToCanvas, wall.id]);

    const commitText = useCallback((id: string, content: string) => {
        const source = latestDraftRef.current.items.find(item => item.id === id);
        const maxLength = source?.author === 'char' ? 300 : 160;
        const normalized = content.trim().slice(0, maxLength);
        updateItem(id, {
            text: {
                content: normalized || '新便签',
                preset: source?.text?.preset || (source?.author === 'char' ? 'char_note' : 'big_plain'),
                color: source?.text?.color,
                stroke: source?.text?.stroke,
                fontAssetId: source?.text?.fontAssetId,
                fontFamily: source?.text?.fontFamily,
                fontSize: source?.text?.fontSize,
                align: source?.text?.align,
                remarkTemplate: source?.text?.remarkTemplate,
            },
        });
        setEditingTextId(null);
    }, [updateItem]);

    const startTrayDrag = useCallback((item: CollectionWallItem, event: React.PointerEvent<HTMLButtonElement>) => {
        if (!editing) return;
        event.preventDefault();
        const pointerId = event.pointerId;
        const start = { x: event.clientX, y: event.clientY };
        let moved = false;
        const handleMove = (moveEvent: PointerEvent) => {
            if (moveEvent.pointerId !== pointerId) return;
            if (Math.abs(moveEvent.clientX - start.x) + Math.abs(moveEvent.clientY - start.y) > 8) moved = true;
        };
        const handleUp = (upEvent: PointerEvent) => {
            if (upEvent.pointerId !== pointerId) return;
            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', handleUp);
            if (!moved) return;
            const point = screenToCanvas(upEvent.clientX, upEvent.clientY);
            const current = latestDraftRef.current;
            const nextId = isLooseWallItem(item) ? createLocalItemId() : item.id;
            const nextItems = current.items.map(candidate => candidate.id === item.id
                ? normalizeWallItemForCanvas({
                    ...candidate,
                    id: nextId,
                    ...normalizeWallItemFrameForCanvas(candidate, {
                        x: point.x - candidate.w / 2,
                        y: point.y - candidate.h / 2,
                    }, { canvasHeight }),
                    z: current.items.reduce((max, existing) => Math.max(max, existing.z || 0), 0) + 1,
                })
                : candidate);
            applyDraft(relabelItems(nextItems), current.wall);
            setSelectedItemId(nextId);
        };
        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', handleUp);
    }, [applyDraft, canvasHeight, editing, screenToCanvas]);

    const clearLongPress = useCallback(() => {
        if (longPressTimerRef.current != null) {
            window.clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    }, []);

    const startItemLongPress = useCallback((item: CollectionWallItem, event: React.PointerEvent<HTMLDivElement>) => {
        clearLongPress();
        const point = { x: event.clientX, y: event.clientY };
        longPressTimerRef.current = window.setTimeout(() => {
            enterEditing();
            setSelectedItemId(item.id);
            setMenuPoint(point);
        }, 520);
    }, [clearLongPress, enterEditing]);

    const renderItem = (item: CollectionWallItem) => {
        const entry = getEntryForItem(item);
        if (!entry) return null;
        const selected = selectedItemId === item.id;
        const style = {
            '--x': `${item.x || 0}px`,
            '--y': `${item.y || 0}px`,
            '--r': `${item.rotation || 0}deg`,
            '--z': item.z || 1,
            '--item-w': `${item.w}px`,
            '--item-h': `${item.h}px`,
        } as React.CSSProperties;

        return (
            <div
                key={item.id}
                ref={node => {
                    if (node) itemRefs.current.set(item.id, node);
                    else itemRefs.current.delete(item.id);
                }}
                className={`ar-wall-free-item${editing ? ' editing' : ''}${selected ? ' selected' : ''}`}
                style={style}
                data-wall-item-id={item.id}
                onPointerDown={event => {
                    if (editing) {
                        setSelectedItemId(item.id);
                        setMenuPoint(null);
                    }
                    startItemLongPress(item, event);
                }}
                onPointerMove={clearLongPress}
                onPointerUp={clearLongPress}
                onPointerCancel={clearLongPress}
                onContextMenu={event => {
                    event.preventDefault();
                    enterEditing();
                    setSelectedItemId(item.id);
                    setMenuPoint({ x: event.clientX, y: event.clientY });
                }}
                onDoubleClick={event => {
                    if (!editing) return;
                    if (entry.type === 'text') {
                        event.stopPropagation();
                        setEditingTextId(item.id);
                    }
                    if (entry.type === 'html') {
                        event.stopPropagation();
                        openHtmlEditor(item.id);
                    }
                }}
                onClick={() => {
                    if (editing) return;
                    if (entry.type === 'book') onPickBook(entry.book);
                    if (entry.type === 'image') onPickImage(entry, draftWall.name);
                }}
            >
                {entry.type === 'book' && (
                    <CollectionWallCardFrame book={entry.book} width={item.w} height={item.h} />
                )}
                {entry.type === 'html' && <CollectionWallHtmlFrame item={item} />}
                {(entry.type === 'image' || entry.type === 'sticker') && <WallImageLayer entry={entry} />}
                {entry.type === 'bond' && (
                    <BondWidgetLayer
                        userName={userName}
                        userAvatar={userAvatar}
                        charName={charName}
                        charAvatar={charAvatar}
                        sinceAt={item.createdAt}
                        avatarFrameAsset={item.bond?.avatarFrame ? assetById.get(item.bond.avatarFrame) || null : null}
                    />
                )}
                {entry.type === 'text' && (
                    <WallTextLayer
                        entry={{ ...entry, item }}
                        charName={charName}
                        charAvatar={charAvatar}
                        fontAsset={item.text?.fontAssetId ? assetById.get(item.text.fontAssetId) || null : null}
                        editing={editingTextId === item.id}
                        onCommit={content => commitText(item.id, content)}
                    />
                )}
            </div>
        );
    };

    return (
        <div
            className={`ar-full-wall${editing ? ' editing' : ''}${preview ? ' preview' : ''}`}
            onClick={() => {
                if (preview) setPreview(false);
                if (actionMenuOpen) setActionMenuOpen(false);
                if (activeAssetActions) setActiveAssetActions(null);
            }}
            style={{
                '--wall-bg': wallBackgroundValue,
                '--wall-dim': renderedWallBackgroundEffects.dim,
                '--wall-noise-opacity': renderedWallBackgroundEffects.noiseOpacity,
                '--wall-scale': scale,
            } as React.CSSProperties}
        >
            <div className="ar-full-bg" />
            {!preview && (
                <>
                    <button type="button" className="ar-full-exit" aria-label="退出拾光墙" onClick={handleWallExit} disabled={savingWallDraft}>‹</button>
                    <div className={`ar-full-actions${actionMenuOpen ? ' open' : ''}`}>
                        <button
                            type="button"
                            className="ar-full-action"
                            aria-expanded={actionMenuOpen}
                            aria-controls="ar-full-action-menu"
                            onClick={(event) => {
                                event.stopPropagation();
                                setActionMenuOpen(prev => !prev);
                            }}
                        >
                            <PaintBrush weight="bold" size={15} />布置
                        </button>
                        {actionMenuOpen && (
                            <div id="ar-full-action-menu" className="ar-full-action-menu" onClick={event => event.stopPropagation()}>
                                <button
                                    type="button"
                                    className="ar-full-menu-action primary"
                                    onClick={() => {
                                        enterEditing();
                                        setActionMenuOpen(false);
                                    }}
                                >
                                    装修
                                </button>
                                <button
                                    type="button"
                                    className="ar-full-menu-action"
                                    onClick={() => {
                                        setPreview(true);
                                        setActionMenuOpen(false);
                                    }}
                                >
                                    预览
                                </button>
                            </div>
                        )}
                    </div>
                </>
            )}
            {!preview && !editing && (
                <CharInviteOrb
                    wall={draftWall}
                    entries={entries}
                    charName={charName}
                    charAvatar={charAvatar}
                    inviteAvatarAsset={inviteAvatarAsset}
                    inviting={inviting}
                    uploading={uploadingInviteAvatar}
                    pinning={pinningRemark}
                    onRequestRemark={(trigger) => onInviteChar(draftWall, entries, charName, trigger)}
                    onUploadAvatar={handleUploadInviteAvatar}
                    onPinRemark={onPinCharRemark}
                />
            )}
            {editing && trayItems.length > 0 && (
                <div className="ar-tray" aria-label="待安置内容">
                    {trayItems.map(item => (
                        <button
                            key={item.id}
                            type="button"
                            className="ar-tray-item"
                            onPointerDown={event => startTrayDrag(item, event)}
                        >
                            {getEditorItemLabel(item, entryByItemId)}
                        </button>
                    ))}
                </div>
            )}
            <div
                className="ar-full-stage-wrap"
                style={{ height: `${viewport.height}px` }}
                onDoubleClick={event => {
                    if (!editing) return;
                    if ((event.target as HTMLElement).closest('.ar-wall-free-item')) return;
                    addTextAt(event.clientX, event.clientY);
                }}
            >
                <div
                    ref={canvasRef}
                    className="ar-full-canvas"
                    style={{ height: canvasHeight }}
                >
                    {visibleItems.length > 0 ? visibleItems.map(renderItem) : (
                        <div className="ar-wall-empty-canvas">这面墙还没有安置内容。</div>
                    )}
                </div>
            </div>
            {editing && selectedTarget && (
                <Moveable
                    target={selectedTarget}
                    draggable
                    resizable
                    rotatable
                    snappable
                    snapDirections={{ top: true, left: true, bottom: true, right: true, center: true, middle: true }}
                    elementSnapDirections={{ top: true, left: true, bottom: true, right: true, center: true, middle: true }}
                    bounds={{ left: 0, top: 0, right: WALL_CANVAS_WIDTH, bottom: canvasHeight }}
                    throttleDrag={0}
                    throttleResize={0}
                    throttleRotate={0}
                    onDrag={({ target, transform, beforeTranslate }: any) => {
                        const item = latestDraftRef.current.items.find(candidate => candidate.id === selectedItemId);
                        const translate = readMoveableTranslate(beforeTranslate);
                        if (item && translate) {
                            const patch = normalizeWallItemFrameForCanvas(item, { x: translate[0], y: translate[1] }, { canvasHeight });
                            setWallItemElementFrameStyle(target, patch);
                            previewTransientItemFrame(item.id, patch);
                        }
                        if (transform) target.style.transform = transform;
                    }}
                    onDragEnd={({ target, lastEvent }: any) => {
                        target.classList.remove('dragging');
                        const item = latestDraftRef.current.items.find(candidate => candidate.id === selectedItemId);
                        const translate = readMoveableTranslate(lastEvent?.beforeTranslate);
                        cancelTransientDraftFrame();
                        if (!item || !translate) {
                            clearMoveableElementOverrides(target);
                            setDraftItems(latestDraftRef.current.items);
                            console.warn('[CollectionWallDebug] draft-move-missing-translate', {
                                wallId: wall.id,
                                itemId: selectedItemId,
                            });
                            return;
                        }
                        const patch = normalizeWallItemFrameForCanvas(item, { x: translate[0], y: translate[1] }, { canvasHeight });
                        setWallItemElementFrameStyle(target, patch);
                        clearMoveableElementOverrides(target);
                        updateItem(item.id, patch);
                        console.info('[CollectionWallDebug] draft-move-end', {
                            wallId: wall.id,
                            itemId: item.id,
                            x: patch.x,
                            y: patch.y,
                            z: item.z,
                            order: item.order,
                        });
                    }}
                    onDragStart={({ target, set }: any) => {
                        cancelTransientDraftFrame();
                        target.classList.add('dragging');
                        const item = latestDraftRef.current.items.find(candidate => candidate.id === selectedItemId);
                        if (item) {
                            set?.(getMoveableStartTranslate(item));
                            console.info('[CollectionWallDebug] draft-move-start', {
                                wallId: wall.id,
                                itemId: item.id,
                                x: item.x,
                                y: item.y,
                                z: item.z,
                                order: item.order,
                            });
                        }
                    }}
                    onResizeStart={({ dragStart }: any) => {
                        cancelTransientDraftFrame();
                        const item = latestDraftRef.current.items.find(candidate => candidate.id === selectedItemId);
                        if (item) dragStart?.set?.(getMoveableStartTranslate(item));
                    }}
                    onResize={({ target, width, height, drag }: any) => {
                        target.style.width = `${width}px`;
                        target.style.height = `${height}px`;
                        const item = latestDraftRef.current.items.find(candidate => candidate.id === selectedItemId);
                        const translate = readMoveableTranslate(drag?.beforeTranslate);
                        if (item) {
                            const rawPatch = {
                                w: width,
                                h: height,
                                ...(translate ? { x: translate[0], y: translate[1] } : {}),
                            };
                            const patch = normalizeWallItemFrameForCanvas(item, rawPatch, { canvasHeight });
                            setWallItemElementFrameStyle(target, patch);
                            previewTransientItemFrame(item.id, patch);
                        }
                        if (drag?.transform) target.style.transform = drag.transform;
                    }}
                    onResizeEnd={({ lastEvent }: any) => {
                        const item = latestDraftRef.current.items.find(candidate => candidate.id === selectedItemId);
                        const target = selectedTarget;
                        const translate = readMoveableTranslate(lastEvent?.drag?.beforeTranslate);
                        cancelTransientDraftFrame();
                        if (!item || !lastEvent) {
                            if (target) clearMoveableElementOverrides(target);
                            setDraftItems(latestDraftRef.current.items);
                            return;
                        }
                        const patch = normalizeWallItemFrameForCanvas(item, {
                            w: lastEvent.width,
                            h: lastEvent.height,
                            ...(translate ? { x: translate[0], y: translate[1] } : {}),
                        }, { canvasHeight });
                        if (target) {
                            setWallItemElementFrameStyle(target, patch);
                            clearMoveableElementOverrides(target);
                        }
                        updateItem(item.id, patch);
                    }}
                    onRotate={({ target, drag }: any) => {
                        const item = latestDraftRef.current.items.find(candidate => candidate.id === selectedItemId);
                        const rawRotation = Number(drag?.beforeRotate ?? drag?.rotate);
                        if (item && Number.isFinite(rawRotation)) {
                            const patch = normalizeWallItemFrameForCanvas(item, {
                                rotation: Number(rawRotation.toFixed(2)),
                            }, { canvasHeight });
                            setWallItemElementFrameStyle(target, patch);
                            previewTransientItemFrame(item.id, patch);
                        }
                        if (drag?.transform) target.style.transform = drag.transform;
                    }}
                    onRotateEnd={({ lastEvent }: any) => {
                        const item = latestDraftRef.current.items.find(candidate => candidate.id === selectedItemId);
                        const target = selectedTarget;
                        cancelTransientDraftFrame();
                        if (!item || !lastEvent) {
                            if (target) clearMoveableElementOverrides(target);
                            setDraftItems(latestDraftRef.current.items);
                            return;
                        }
                        const nextRotation = Number(lastEvent.beforeRotate ?? lastEvent.rotate ?? item.rotation ?? 0);
                        const patch = normalizeWallItemFrameForCanvas(item, {
                            rotation: Number(nextRotation.toFixed(2)),
                        }, { canvasHeight });
                        if (target) {
                            setWallItemElementFrameStyle(target, patch);
                            clearMoveableElementOverrides(target);
                        }
                        updateItem(item.id, patch);
                    }}
                />
            )}
            {editing && selectedItem && (
                <div className="ar-selection-actions" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
                    <button type="button" aria-label="向左旋转" title="向左旋转" onClick={() => rotateItemBy(selectedItem.id, -15)}><ArrowCounterClockwise weight="bold" size={14} />左转</button>
                    <button type="button" aria-label="向右旋转" title="向右旋转" onClick={() => rotateItemBy(selectedItem.id, 15)}><ArrowClockwise weight="bold" size={14} />右转</button>
                    <button type="button" onClick={() => editSelectedItem(selectedItem.id)}>编辑</button>
                    <button type="button" onClick={() => bringToFront(selectedItem.id)}>置顶</button>
                    <button type="button" className="danger" onClick={() => requestDeleteItem(selectedItem.id)}>删除</button>
                </div>
            )}
            {editing && selectedUserTextItem && (
                <section className="ar-text-style-panel" aria-label="文字样式" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
                    <div className="ar-text-style-head">
                        <span>
                            <b>文字样式</b>
                            <small>{getTextFontLabel(selectedTextFontAsset)}</small>
                        </span>
                        <button type="button" onClick={() => textFontInputRef.current?.click()} disabled={uploadingFont}>
                            <UploadSimple weight="bold" size={13} />{uploadingFont ? '处理中' : '上传字体'}
                        </button>
                        <input
                            ref={textFontInputRef}
                            type="file"
                            hidden
                            accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2,application/vnd.ms-opentype"
                            onChange={handleUploadTextFont}
                        />
                    </div>
                    <div className="ar-text-color-row">
                        {WALL_TEXT_COLORS.map(color => (
                            <button
                                key={color}
                                type="button"
                                className={(selectedUserTextItem.text?.color || '#4d3438').toLowerCase() === color.toLowerCase() ? 'on' : ''}
                                style={{ '--text-color': color } as React.CSSProperties}
                                aria-label={`文字颜色 ${color}`}
                                onClick={() => updateTextStyle(selectedUserTextItem.id, { color })}
                            />
                        ))}
                        <label className="ar-text-color-picker">
                            <span>自选</span>
                            <input
                                type="color"
                                value={selectedUserTextItem.text?.color || '#4d3438'}
                                onChange={event => updateTextStyle(selectedUserTextItem.id, { color: event.target.value })}
                            />
                        </label>
                    </div>
                    <label className="ar-text-range">
                        <span>字号 {clamp(Number(selectedUserTextItem.text?.fontSize) || 28, 12, 72)}px</span>
                        <input
                            type="range"
                            min="12"
                            max="72"
                            value={clamp(Number(selectedUserTextItem.text?.fontSize) || 28, 12, 72)}
                            onChange={event => updateTextStyle(selectedUserTextItem.id, { fontSize: Number(event.target.value) })}
                        />
                    </label>
                    <div className="ar-text-style-actions">
                        {(['left', 'center', 'right'] as const).map(align => (
                            <button
                                key={align}
                                type="button"
                                className={(selectedUserTextItem.text?.align || 'center') === align ? 'on' : ''}
                                onClick={() => updateTextStyle(selectedUserTextItem.id, { align })}
                            >
                                {align === 'left' ? '左' : align === 'right' ? '右' : '中'}
                            </button>
                        ))}
                        <label className="ar-text-stroke">
                            <input
                                type="checkbox"
                                checked={Boolean(selectedUserTextItem.text?.stroke)}
                                onChange={event => updateTextStyle(selectedUserTextItem.id, { stroke: event.target.checked })}
                            />
                            描边
                        </label>
                        {selectedUserTextItem.text?.fontAssetId && (
                            <button type="button" onClick={() => updateTextStyle(selectedUserTextItem.id, { fontAssetId: undefined, fontFamily: undefined })}>默认字体</button>
                        )}
                    </div>
                </section>
            )}
            {editing && selectedItemId && menuPoint && (
                <div
                    className="ar-wall-item-menu"
                    style={{ left: Math.min(menuPoint.x, viewport.width - 330), top: Math.max(56, menuPoint.y - 48) }}
                >
                    <button type="button" data-menu="edit" onClick={() => editSelectedItem(selectedItemId)}>编辑</button>
                    <button type="button" onClick={() => bringToFront(selectedItemId)}>置顶</button>
                    <button type="button" onClick={() => sendToBack(selectedItemId)}>置底</button>
                    <button type="button" onClick={() => renameItem(selectedItemId)}>起名</button>
                    <button type="button" data-menu="delete" onClick={() => requestDeleteItem(selectedItemId)}>删除</button>
                </div>
            )}
            {editing && libraryOpen && !preview && (
                <section className="ar-asset-drawer" aria-label="拾光墙素材库">
                    <div className="ar-asset-drawer-hd">
                        <div>
                            <h3>素材库</h3>
                            <p>{customLibraryAssets.length} 件自定义素材</p>
                        </div>
                        <button
                            type="button"
                            className="ar-asset-upload"
                            disabled={uploadingAsset}
                            onClick={() => assetFileInputRef.current?.click()}
                        >
                            <UploadSimple weight="bold" size={14} />{uploadingAsset ? '处理中' : '上传'}
                        </button>
                        <input
                            ref={assetFileInputRef}
                            type="file"
                            hidden
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            onChange={handleUploadLibraryAsset}
                        />
                    </div>
                    {customLibraryAssets.length === 0 ? (
                        <div className="ar-asset-empty">还没有自定义素材。</div>
                    ) : (
                        <div className="ar-asset-grid">
                            {customLibraryAssets.map(asset => (
                                <WallAssetLibraryCard
                                    key={asset.id}
                                    asset={asset}
                                    onUseSticker={(nextAsset) => addAssetToWall(nextAsset, 'sticker')}
                                    onUseImage={(nextAsset) => addAssetToWall(nextAsset, 'image')}
                                    onUseBackground={handleSetAssetBackground}
                                    onUseAvatarFrame={handleSetAvatarFrame}
                                    onOpenActions={setActiveAssetActions}
                                    onRemove={handleRemoveLibraryAsset}
                                />
                            ))}
                        </div>
                    )}
                </section>
            )}
            {editing && activeAssetActions && !preview && (
                <WallAssetActionSheet
                    asset={activeAssetActions}
                    onUseImage={(asset) => addAssetToWall(asset, 'image')}
                    onUseSticker={(asset) => addAssetToWall(asset, 'sticker')}
                    onUseBackground={handleSetAssetBackground}
                    onUseAvatarFrame={handleSetAvatarFrame}
                    onRemove={handleRemoveLibraryAsset}
                    onClose={() => setActiveAssetActions(null)}
                />
            )}
            {editing && htmlEditor && !preview && (
                <section
                    className="html-modal open"
                    aria-label="自定义 HTML 卡"
                    onMouseDown={event => event.stopPropagation()}
                    onPointerDown={event => event.stopPropagation()}
                >
                    <div className="html-panel">
                        <div className="html-panel-hd">
                            <h3>自定义 HTML 卡</h3>
                            <button type="button" className="html-x" aria-label="关闭" onClick={() => setHtmlEditor(null)}>×</button>
                        </div>
                        <p className="html-hint">粘贴或上传一段 HTML，会作为一张卡片渲染到墙上。</p>
                        <button type="button" className="html-upload" onClick={() => htmlFileInputRef.current?.click()}>
                            <UploadSimple weight="bold" size={14} />上传 HTML
                        </button>
                        <input
                            ref={htmlFileInputRef}
                            type="file"
                            hidden
                            accept=".html,.htm,text/html"
                            onChange={handleHtmlFileUpload}
                        />
                        <textarea
                            className="html-input"
                            value={htmlEditor.draft}
                            maxLength={CUSTOM_WALL_HTML_MAX_CHARS}
                            spellCheck={false}
                            onChange={event => setHtmlEditor(prev => prev ? { ...prev, draft: event.target.value } : prev)}
                        />
                        <div className="html-actions">
                            {htmlEditor.itemId && (
                                <button
                                    type="button"
                                    className="danger"
                                    onClick={() => {
                                        const itemId = htmlEditor?.itemId;
                                        if (!itemId) return;
                                        if (requestDeleteItem(itemId, '确定删除这张 HTML 卡吗？')) {
                                            setHtmlEditor(null);
                                            say('HTML 卡已删除');
                                        }
                                    }}
                                >
                                    删除这张 HTML 卡
                                </button>
                            )}
                            <button type="button" onClick={() => setHtmlEditor(null)}>取消</button>
                            <button type="button" className="primary" onClick={commitHtmlCard}>插入 / 更新</button>
                        </div>
                    </div>
                </section>
            )}
            {editing && (
                <input
                    ref={decorPresetFileInputRef}
                    type="file"
                    hidden
                    accept=".json,application/json"
                    onChange={handleImportDecorPresetFile}
                />
            )}
            {editing && (
                <div className={`ar-edit-toolbar${toolboxOpen ? ' open' : ' collapsed'}`}>
                    <button type="button" className="ar-edit-done" onClick={finishEditing} disabled={savingWallDraft}>
                        <Check weight="bold" size={15} />{savingWallDraft ? '保存中' : '完成'}
                    </button>
                    <button
                        type="button"
                        className="ar-edit-toggle"
                        aria-expanded={toolboxOpen}
                        onClick={() => setToolboxOpen(prev => !prev)}
                    >
                        <PaintBrush weight="bold" size={15} />{toolboxOpen ? '收起' : '工具'}
                    </button>
                    {toolboxOpen && (
                        <span className="ar-edit-tools">
                            <button type="button" onClick={() => addTextAt(viewport.width / 2, viewport.height * 0.42)}><PencilSimple weight="bold" size={15} />便签</button>
                            <button type="button" onClick={() => openHtmlEditor()}><PencilSimple weight="bold" size={15} />HTML卡</button>
                            <button type="button" onClick={() => setLibraryOpen(prev => !prev)}><ImageSquare weight="bold" size={15} />素材库</button>
                            <button type="button" onClick={handleExportDecorPreset}><PaperPlaneTilt weight="bold" size={15} />导出预设</button>
                            <button type="button" disabled={importingPreset} onClick={() => decorPresetFileInputRef.current?.click()}><UploadSimple weight="bold" size={15} />{importingPreset ? '导入中' : '导入预设'}</button>
                            <button type="button" onClick={arrangeAll}>整理</button>
                        </span>
                    )}
                    <button type="button" aria-label="撤销" title="撤销" disabled={past.length === 0} onClick={undo}><ArrowCounterClockwise weight="bold" size={17} /></button>
                    <button type="button" aria-label="重做" title="重做" disabled={future.length === 0} onClick={redo}><ArrowClockwise weight="bold" size={17} /></button>
                    <button type="button" onClick={cancelEditing} disabled={savingWallDraft}><X weight="bold" size={15} />取消</button>
                </div>
            )}
            <span className="ar-preview-hint">点击任意处退出预览</span>
        </div>
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

type WallCanvasRect = Pick<DOMRect, 'left' | 'top'>;
type WallItemFramePatch = Partial<Pick<CollectionWallItem, 'x' | 'y' | 'w' | 'h' | 'rotation'>>;

export const clientPointToWallCanvasPoint = (
    clientX: number,
    clientY: number,
    rect: WallCanvasRect,
    scale: number,
): { x: number; y: number } => {
    const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    return {
        x: (clientX - rect.left) / safeScale,
        y: (clientY - rect.top) / safeScale,
    };
};

export const getViewportWallCanvasHeight = (viewportHeight: number, scale: number): number => {
    const safeHeight = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 800;
    const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    return Math.max(1, Math.ceil(safeHeight / safeScale));
};

export const getMoveableStartTranslate = (item: CollectionWallItem): [number, number] => [
    Number.isFinite(item.x) && item.x != null ? item.x : 0,
    Number.isFinite(item.y) && item.y != null ? item.y : 0,
];

const readMoveableTranslate = (value: unknown): [number, number] | null => {
    if (!Array.isArray(value) || value.length < 2) return null;
    const x = Number(value[0]);
    const y = Number(value[1]);
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
};

const setWallItemElementFrameStyle = (target: HTMLElement, patch: WallItemFramePatch): void => {
    if (typeof patch.x === 'number' && Number.isFinite(patch.x)) {
        target.style.setProperty('--x', `${Math.round(patch.x)}px`);
    }
    if (typeof patch.y === 'number' && Number.isFinite(patch.y)) {
        target.style.setProperty('--y', `${Math.round(patch.y)}px`);
    }
    if (typeof patch.w === 'number' && Number.isFinite(patch.w) && patch.w > 0) {
        target.style.setProperty('--item-w', `${Math.round(patch.w)}px`);
    }
    if (typeof patch.h === 'number' && Number.isFinite(patch.h) && patch.h > 0) {
        target.style.setProperty('--item-h', `${Math.round(patch.h)}px`);
    }
    if (typeof patch.rotation === 'number' && Number.isFinite(patch.rotation)) {
        target.style.setProperty('--r', `${Number(patch.rotation.toFixed(2))}deg`);
    }
};

const clearMoveableElementOverrides = (target: HTMLElement): void => {
    target.style.transform = '';
    target.style.width = '';
    target.style.height = '';
};

export const normalizeWallItemFrameForCanvas = (
    item: CollectionWallItem,
    patch: WallItemFramePatch,
    options: { canvasHeight?: number } = {},
): WallItemFramePatch => {
    const fallback = getDefaultWallItemSize(item);
    const currentW = Number.isFinite(item.w) && item.w > 0 ? item.w : fallback.w;
    const currentH = Number.isFinite(item.h) && item.h > 0 ? item.h : fallback.h;
    const rawW = patch.w ?? item.w;
    const rawH = patch.h ?? item.h;
    const w = clamp(Number.isFinite(rawW) && rawW > 0 ? Math.round(rawW) : currentW, 1, WALL_CANVAS_WIDTH);
    const h = Math.max(1, Number.isFinite(rawH) && rawH > 0 ? Math.round(rawH) : currentH);
    const maxX = Math.max(0, WALL_CANVAS_WIDTH - w);
    const maxY = Number.isFinite(options.canvasHeight)
        ? Math.max(0, Number(options.canvasHeight) - h)
        : Number.POSITIVE_INFINITY;
    const next: WallItemFramePatch = {};

    if (Object.prototype.hasOwnProperty.call(patch, 'w')) next.w = w;
    if (Object.prototype.hasOwnProperty.call(patch, 'h')) next.h = h;
    if (Object.prototype.hasOwnProperty.call(patch, 'x')) {
        next.x = typeof patch.x === 'number' && Number.isFinite(patch.x)
            ? clamp(Math.round(patch.x), 0, maxX)
            : null;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'y')) {
        next.y = typeof patch.y === 'number' && Number.isFinite(patch.y)
            ? Math.min(maxY, Math.max(0, Math.round(patch.y)))
            : null;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'rotation')) {
        const rotation = typeof patch.rotation === 'number' && Number.isFinite(patch.rotation)
            ? patch.rotation
            : item.rotation || 0;
        next.rotation = Number(rotation.toFixed(2));
    }

    return next;
};

export function getWallBackgroundEffects(background?: CollectionWall['background']): { dim: number; noiseOpacity: number } {
    if (background?.type === 'asset') return { dim: 0, noiseOpacity: 0 };
    const rawDim = Number(background?.dim);
    return {
        dim: clamp(Number.isFinite(rawDim) ? rawDim : 0.18, 0, 0.6),
        noiseOpacity: 0.035,
    };
}

const relabelItems = (items: CollectionWallItem[]): CollectionWallItem[] =>
    items.map((item, index) => ({ ...item, order: index, z: item.z || index + 1 }));

const relabelItemOrderPreservingLayer = (items: CollectionWallItem[]): CollectionWallItem[] =>
    items.map((item, index) => ({
        ...item,
        order: index,
        z: Number.isFinite(item.z) ? item.z : index + 1,
    }));

const preserveFreeLayoutItemOrder = (items: CollectionWallItem[]): CollectionWallItem[] =>
    items.map((item, index) => ({
        ...item,
        order: Number.isFinite(item.order) ? item.order : index,
        z: Number.isFinite(item.z) ? item.z : index + 1,
    }));

const compareWallItemsStable = (a: CollectionWallItem, b: CollectionWallItem): number => (
    (Number.isFinite(a.order) ? a.order : 0) - (Number.isFinite(b.order) ? b.order : 0)
    || (a.createdAt || 0) - (b.createdAt || 0)
    || String(a.id || '').localeCompare(String(b.id || ''))
);

const isLooseWallItem = (item: CollectionWallItem): boolean => item.id.startsWith('loose-');

export const materializePlacedLooseWallItems = (items: CollectionWallItem[]): CollectionWallItem[] =>
    items.map(item => (
        isLooseWallItem(item) && item.x != null && item.y != null
            ? { ...item, id: createLocalItemId() }
            : item
    ));

export const normalizeWallDraftItemsForSave = (items: CollectionWallItem[]): CollectionWallItem[] =>
    preserveFreeLayoutItemOrder(materializePlacedLooseWallItems(items));

export const getPersistableWallItems = (items: CollectionWallItem[]): CollectionWallItem[] =>
    normalizeWallDraftItemsForSave(items).filter(item => !isLooseWallItem(item));

const getEditorItemLabel = (item: CollectionWallItem, entryByItemId: Map<string, WallZoneEntry>): string => {
    const entry = entryByItemId.get(item.id);
    if (entry?.type === 'book') return getCollectionDisplayTitle(entry.book);
    if (entry?.type === 'image' || entry?.type === 'sticker') return getAssetLabel(entry.asset, item);
    if (entry?.type === 'bond' || item.type === 'bond') return item.name || '头像连接';
    if (entry?.type === 'html' || item.type === 'html' || item.html) return getHtmlCardLabel(item);
    if (item.type === 'text') return getTextLabel(item);
    return item.name || item.type;
};

const getEditorItemKind = (item: CollectionWallItem): string => {
    if (item.type === 'html' || item.html) return '自制 HTML 卡';
    if (item.type === 'card') return '视觉碎片';
    if (item.type === 'image') return '图片素材';
    if (item.type === 'bond') return '头像连接组件';
    if (item.type === 'text') return item.author === 'char' ? 'TA 的便签' : '文字便签';
    return '贴纸';
};

const getWallEntryLabel = (entry: WallZoneEntry): string => {
    if (entry.type === 'book') return getFreeformShape(entry.book) || getCollectionDisplayTitle(entry.book);
    if (entry.type === 'image' || entry.type === 'sticker') return getAssetLabel(entry.asset, entry.item);
    if (entry.type === 'bond') return entry.item.name || '头像连接';
    if (entry.type === 'html') return getHtmlCardLabel(entry.item);
    return getTextLabel(entry.item);
};

const describeWallPosition = (item?: CollectionWallItem): string => {
    if (!item || item.x == null || item.y == null) return '未安置';
    const centerX = item.x + item.w / 2;
    const centerY = item.y + item.h / 2;
    const horizontal = centerX < WALL_CANVAS_WIDTH / 3 ? '左' : centerX > WALL_CANVAS_WIDTH * 2 / 3 ? '右' : '中';
    const vertical = centerY < 260 ? '上' : centerY > 620 ? '下' : '中';
    if (horizontal === '中' && vertical === '中') return '正中';
    if (horizontal === '中') return `中${vertical}`;
    if (vertical === '中') return `${horizontal}中`;
    return `${horizontal}${vertical}`;
};

const describeWallItemSize = (item?: CollectionWallItem): string => {
    if (!item) return '中';
    const area = item.w * item.h;
    if (area >= 95000) return '大';
    if (area <= 42000) return '小';
    return '中';
};

const describeWallBackground = (wall: CollectionWall): string => {
    const value = String(wall.background?.value || '').toLowerCase();
    const swatch = WALL_BACKGROUND_SWATCHES.find(item => item.value.toLowerCase() === value);
    const dim = getWallBackgroundEffects(wall.background).dim;
    const dimText = dim <= 0.02 ? '未压暗' : `压暗 ${Math.round(dim * 100)}%`;
    if (wall.background?.type === 'asset') return `自定义图片壁纸，${dimText}`;
    return `${swatch?.name || wall.background?.value || '自定义背景'}，${dimText}`;
};

const getWallEntrySource = (entry: WallZoneEntry): string | undefined => {
    if (entry.type === 'book') {
        const ts = entry.book.sourceMessageTimestamp || entry.book.collectedAt || entry.book.createdAt;
        return ts ? `${fmtDate(ts).slice(5)} 的对话` : undefined;
    }
    if (entry.type === 'image' || entry.type === 'sticker') {
        if (entry.asset.origin === 'chat_gen') return '聊天里生成';
        if (entry.asset.origin === 'char') return 'TA 添加';
        return '用户上传';
    }
    if (entry.type === 'bond') return '墙头装饰';
    if (entry.type === 'html') return '自制 HTML 卡';
    return entry.item.author === 'char' ? 'TA 留下的便签' : '用户便签';
};

const toManifestItem = (entry: WallZoneEntry): CollectionWallManifestItem => {
    if (entry.type === 'bond') {
        return {
            type: 'html',
            label: entry.item.name || '头像连接',
            from: '墙头装饰',
            pos: describeWallPosition(entry.item),
            size: describeWallItemSize(entry.item),
        };
    }
    const baseLabel = getWallEntryLabel(entry);
    const item = entry.type === 'book' ? entry.item : entry.item;
    const type = entry.type === 'book' ? 'card' : entry.type;
    const label = entry.type === 'text'
        ? `${entry.item.author === 'char' ? 'TA 的便签' : '用户便签'}：${baseLabel}`
        : baseLabel;
    return {
        type,
        label,
        from: getWallEntrySource(entry),
        pos: describeWallPosition(item),
        size: describeWallItemSize(item),
    };
};

const buildRecentChanges = (entries: WallZoneEntry[]): string[] =>
    [...entries]
        .sort((a, b) => getWallEntryTimestamp(b) - getWallEntryTimestamp(a))
        .slice(0, 3)
        .map(entry => `新贴了「${getWallEntryLabel(entry).slice(0, 18)}」`);

const buildRecentChatTopic = (messages: Message[]): string | undefined => {
    const snippets = messages
        .filter(message => message.role === 'user' || message.role === 'assistant')
        .slice(-6)
        .map(message => String(message.content || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .map(text => text.slice(0, 42));
    return snippets.length > 0 ? snippets.join(' / ').slice(0, 180) : undefined;
};

const buildWallManifest = (
    wall: CollectionWall,
    entries: WallZoneEntry[],
    messages: Message[],
): CollectionWallManifest => ({
    wallName: wall.name || '未分类',
    background: describeWallBackground(wall),
    items: entries.filter(entry => entry.type !== 'bond').map(toManifestItem),
    recentChanges: buildRecentChanges(entries.filter(entry => entry.type !== 'bond')),
    charPreviousRemarks: (wall.charRemarks || []).slice(-8).map(remark => remark.text),
    recentChatTopic: buildRecentChatTopic(messages),
});

const getRecentAnchorItem = (entries: WallZoneEntry[]): CollectionWallItem | null => {
    const entry = [...entries]
        .filter(candidate => candidate.type !== 'bond' && Boolean(candidate.item) && candidate.item?.author !== 'char')
        .sort((a, b) => getWallEntryTimestamp(b) - getWallEntryTimestamp(a))[0];
    return entry?.item || null;
};

const cleanHistoryApiMessages = (messages: { role: string; content: any }[]): ChatCompletionMessage[] =>
    messages.map((message) => {
        if (typeof message.content !== 'string') return message as ChatCompletionMessage;
        let content = message.content;
        const biRe = /%%\s*BILINGUAL\s*%%/i;
        if (biRe.test(content)) {
            content = content.substring(0, content.search(biRe)).trim();
        }
        if (content.includes('<翻译>')) {
            content = content.replace(/<翻译>\s*<原文>([\s\S]*?)<\/原文>\s*<译文>[\s\S]*?<\/译文>\s*<\/翻译>/g, '$1').trim();
        }
        return { ...message, content } as ChatCompletionMessage;
    });

const buildCharWallVisitMessages = async (options: {
    char: CharacterProfile;
    userProfile: UserProfile;
    groups: GroupProfile[];
    realtimeConfig?: RealtimeConfig;
    apiConfig: APIConfig;
    wall: CollectionWall;
    entries: WallZoneEntry[];
    trigger: CollectionWallVisitTrigger;
}): Promise<{ messages: ChatCompletionMessage[]; manifest: CollectionWallManifest; history: Message[] }> => {
    const limit = options.char.contextLimit || 500;
    const [history, emojis, categories, characterGoals] = await Promise.all([
        DB.getMessagesByCharId(options.char.id),
        DB.getEmojis(),
        DB.getEmojiCategories(),
        loadCharacterGoals(options.char.id).catch(error => {
            console.warn('[CollectionHall] goals load failed:', error);
            return [] as Awaited<ReturnType<typeof loadCharacterGoals>>;
        }),
    ]);
    const contextHistory = history.slice(-limit);
    const embeddingApiKey = getEmbeddingConfig().apiKey || undefined;
    const baseSystemPrompt = await ChatPrompts.buildSystemPrompt(
        options.char,
        options.userProfile,
        options.groups,
        emojis,
        categories,
        contextHistory,
        options.realtimeConfig,
        options.apiConfig,
        embeddingApiKey,
        characterGoals,
    );
    const manifest = buildWallManifest(options.wall, options.entries, contextHistory);
    const { apiMessages } = ChatPrompts.buildMessageHistory(contextHistory, limit, options.char, options.userProfile, emojis);
    const systemPrompt = `${baseSystemPrompt}\n\n${buildCollectionWallVisitSystemPrompt({
        userName: options.userProfile.name,
        wallName: options.wall.name,
        trigger: options.trigger,
    })}`;

    return {
        messages: [
            { role: 'system', content: systemPrompt },
            ...cleanHistoryApiMessages(apiMessages),
            { role: 'user', content: buildCollectionWallVisitUserPrompt(manifest) },
        ],
        manifest,
        history: contextHistory,
    };
};

const WallEditor: React.FC<{
    wall: CollectionWall;
    entries: WallZoneEntry[];
    onClose: () => void;
    onSaved: () => Promise<unknown> | void;
    onDirtyChange?: (dirty: boolean) => void;
    onSavingChange?: (saving: boolean) => void;
    say: (message: string) => void;
}> = ({ wall, entries, onClose, onSaved, onDirtyChange, onSavingChange, say }) => {
    const [draftWall, setDraftWall] = useState<CollectionWall>({ ...wall, layoutMode: 'free' });
    const [draftItems, setDraftItems] = useState<CollectionWallItem[]>(() => preserveFreeLayoutItemOrder(entries.map(entry => entry.item).filter((item): item is CollectionWallItem => Boolean(item))));
    const [textDraft, setTextDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const entryByItemId = useMemo(() => new Map(entries.filter(entry => Boolean(entry.item)).map(entry => [entry.item!.id, entry])), [entries]);
    const initialDraftSnapshotRef = useRef('');
    if (!initialDraftSnapshotRef.current) {
        initialDraftSnapshotRef.current = serializeWallEditorDraft({ ...wall, layoutMode: 'free' }, draftItems, '');
    }
    const hasUnsavedChanges = hasWallEditorDraftChanges(initialDraftSnapshotRef.current, draftWall, draftItems, textDraft);

    useEffect(() => {
        onDirtyChange?.(hasUnsavedChanges);
        return () => onDirtyChange?.(false);
    }, [hasUnsavedChanges, onDirtyChange]);

    useEffect(() => {
        onSavingChange?.(saving);
        return () => onSavingChange?.(false);
    }, [onSavingChange, saving]);

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
            if (saving) {
                say('正在保存...');
                window.history.pushState(state, '', window.location.href);
                return;
            }
            if (window.confirm('未保存更改')) {
                onClose();
                return;
            }
            window.history.pushState(state, '', window.location.href);
        };
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [hasUnsavedChanges, onClose, saving, say]);

    const requestClose = useCallback(() => {
        if (saving) {
            say('正在保存...');
            return;
        }
        if (!hasUnsavedChanges || window.confirm('未保存更改')) {
            onClose();
        }
    }, [hasUnsavedChanges, onClose, saving, say]);

    const updateWall = (patch: Partial<CollectionWall>) => {
        setDraftWall(prev => ({ ...prev, ...patch }));
    };

    const moveItem = (id: string, delta: number) => {
        setDraftItems(prev => {
            const next = [...prev];
            const index = next.findIndex(item => item.id === id);
            const target = index + delta;
            if (index < 0 || target < 0 || target >= next.length) return prev;
            const [item] = next.splice(index, 1);
            next.splice(target, 0, item);
            return relabelItemOrderPreservingLayer(next);
        });
    };

    const addTextItem = () => {
        const content = textDraft.trim();
        if (!content) {
            say('先写一点便签内容');
            return;
        }
        const now = Date.now();
        setDraftItems(prev => {
            const maxOrder = prev.reduce((max, item) => Math.max(max, Number.isFinite(item.order) ? item.order : -1), -1);
            const maxZ = prev.reduce((max, item) => Math.max(max, Number.isFinite(item.z) ? item.z : 0), 0);
            return [
                ...prev,
                {
                    id: createLocalItemId(),
                    wallId: wall.id,
                    type: 'text',
                    author: 'user',
                    x: null,
                    y: null,
                    w: 220,
                    h: 150,
                    rotation: 0,
                    z: maxZ + 1,
                    order: maxOrder + 1,
                    text: { content: content.slice(0, 120), preset: 'sticky_note' },
                    name: '文字便签',
                    createdAt: now,
                },
            ];
        });
        setTextDraft('');
    };

    const deleteItem = (id: string) => {
        const deleted = draftItems.find(item => item.id === id);
        if (deleted?.type === 'bond') {
            setDraftWall(prev => ({ ...prev, defaultBondWidgetHidden: true }));
        }
        setDraftItems(prev => prev.filter(item => item.id !== id));
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
            const saved = await saveCollectionWallEditorDraftSnapshot({
                name,
                draftWall,
                wallId: wall.id,
                items: normalizeWallDraftItemsForSave(draftItems),
                writeSnapshot: DB.replaceCollectionWallSnapshot,
                refreshAfterSave: onSaved,
            });
            addCollectionWallPendingContext(wall.charId, `用户最近在「${saved.wall.name}」整理了拾光墙，墙上现在有 ${saved.items.length} 件内容。下次对话可自然提及，不要刻意。`);
            initialDraftSnapshotRef.current = serializeWallEditorDraft(saved.wall, saved.items, '');
            setDraftWall({ ...saved.wall, layoutMode: 'free' });
            setDraftItems(preserveFreeLayoutItemOrder(saved.items));
            setTextDraft('');
            say('拾光墙已保存');
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
                        <h3>装修「{draftWall.name || wall.name}」</h3>
                        <p>{draftItems.length} 件 · 顺序排列</p>
                    </div>
                    <button type="button" className="ar-ebk-x" aria-label="关闭" onClick={requestClose} disabled={saving}><X weight="bold" /></button>
                </div>
                <div className="ar-editor-body">
                    <section className="ar-editor-section">
                        <p className="ar-editor-sec-title">墙信息</p>
                        <div className="ar-editor-grid">
                            <label className="ar-field">
                                <span>名称</span>
                                <input value={draftWall.name} maxLength={12} onChange={event => updateWall({ name: event.target.value.slice(0, 12) })} />
                            </label>
                            <label className="ar-field">
                                <span>排列</span>
                                <input value="顺序排列" readOnly />
                            </label>
                        </div>
                    </section>

                    <section className="ar-editor-section">
                        <p className="ar-editor-sec-title">外观</p>
                        <div className="ar-editor-grid">
                            <label className="ar-field">
                                <span>背景</span>
                                <span className="ar-swatch-row">
                                    {WALL_BACKGROUND_SWATCHES.map(swatch => (
                                        <button
                                            type="button"
                                            key={swatch.value}
                                            className={`ar-swatch${(draftWall.background.value || '#17120e').toLowerCase() === swatch.value ? ' on' : ''}`}
                                            style={{ '--sw': swatch.value } as React.CSSProperties}
                                            aria-label={swatch.name}
                                            title={swatch.name}
                                            onClick={() => updateWall({ background: { ...draftWall.background, type: 'color', value: swatch.value } })}
                                        />
                                    ))}
                                </span>
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
                        </div>
                    </section>

                    <section className="ar-editor-section">
                        <p className="ar-editor-sec-title">内容</p>
                        <div className="ar-note-compose">
                            <label className="ar-field">
                                <span>新增文字便签</span>
                                <textarea className="ar-note-input" value={textDraft} maxLength={120} onChange={event => setTextDraft(event.target.value)} placeholder="写一张贴在墙上的小纸条..." />
                            </label>
                            <button type="button" onClick={addTextItem}>插入便签</button>
                        </div>
                        <div className="ar-editor-list">
                            {draftItems.map((item, index) => (
                                <div key={item.id} className="ar-editor-item">
                                    <span>
                                        <b>{getEditorItemLabel(item, entryByItemId)}</b>
                                        <small>{String(index + 1).padStart(2, '0')} · {getEditorItemKind(item)}</small>
                                    </span>
                                    <span className="ar-editor-mini">
                                        <button type="button" aria-label="上移" title="上移" onClick={() => moveItem(item.id, -1)}><ArrowUp weight="bold" size={16} /></button>
                                        <button type="button" aria-label="下移" title="下移" onClick={() => moveItem(item.id, 1)}><ArrowDown weight="bold" size={16} /></button>
                                        {item.type !== 'card' && <button type="button" className="text" onClick={() => deleteItem(item.id)}>删除</button>}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </section>
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

type ArchiveSectionTab = 'bookcase' | 'keepsakes' | 'walls';

const CharacterArchivePage: React.FC<{
    char: HallCharacter;
    hue: number;
    afterglow: CollectionBook[];
    heartTalks: CollectionBook[];
    freeform: CollectionBook[];
    wallZones: LightWallZoneData[];
    pullingId: string | null;
    onPickBook: (book: CollectionBook) => void;
    onOpenWall: (wall: CollectionWall, entries: WallZoneEntry[], charName: string) => void;
}> = ({
    char,
    hue,
    afterglow,
    heartTalks,
    freeform,
    wallZones,
    pullingId,
    onPickBook,
    onOpenWall,
}) => {
    const [activeTab, setActiveTab] = useState<ArchiveSectionTab>(() => (
        afterglow.length > 0 ? 'bookcase' : heartTalks.length > 0 ? 'keepsakes' : 'walls'
    ));

    return (
        <div className="ar-page">
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

            <nav className="ar-seg" aria-label={`${char.name} 的典藏分区`}>
                <button type="button" className={activeTab === 'bookcase' ? 'on' : ''} onClick={() => setActiveTab('bookcase')}>书柜</button>
                <button type="button" className={activeTab === 'keepsakes' ? 'on' : ''} onClick={() => setActiveTab('keepsakes')}>妆匣</button>
                <button type="button" className={activeTab === 'walls' ? 'on' : ''} onClick={() => setActiveTab('walls')}>拾光墙</button>
            </nav>

            {activeTab === 'bookcase' && (
                afterglow.length > 0 ? (
                    <BookCabinet char={char} books={afterglow} pullingId={pullingId} onPick={onPickBook} />
                ) : (
                    <div className="ar-section-empty">这只书柜还在等第一本番外。</div>
                )
            )}
            {activeTab === 'keepsakes' && (
                heartTalks.length > 0 ? (
                    <KeepsakeBox books={heartTalks} pullingId={pullingId} onPick={onPickBook} />
                ) : (
                    <div className="ar-section-empty">妆匣里还没有谈心卡。</div>
                )
            )}
            {activeTab === 'walls' && (
                <LightWallShelf
                    zones={wallZones}
                    onOpenWall={(wall, entries) => onOpenWall(wall, entries, char.name)}
                />
            )}
        </div>
    );
};

const copyTextToClipboard = async (text: string): Promise<void> => {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (!copied) throw new Error('copy failed');
};

const CollectionWallDebugPanel: React.FC<{ say: (message: string) => void }> = ({ say }) => {
    const [open, setOpen] = useState(false);
    const [logs, setLogs] = useState<CollectionWallDebugLogEntry[]>(() => getCollectionWallDebugLogs());

    useEffect(() => subscribeCollectionWallDebugLogs(() => {
        setLogs(getCollectionWallDebugLogs());
    }), []);

    const displayedLogs = logs.slice(-60);

    const handleCopyDiagnostics = useCallback(async () => {
        const text = formatCollectionWallDebugDiagnostics(logs);
        if (!text) {
            say('还没有拾光墙日志');
            return;
        }
        try {
            await copyTextToClipboard(text);
            say('已复制诊断摘要');
        } catch (error) {
            console.error('[CollectionWallDebug] panel-copy-error', error);
            say('复制失败，请长按摘要手动复制');
        }
    }, [logs, say]);

    const handleClear = useCallback(() => {
        clearCollectionWallDebugLogs();
        setLogs([]);
        say('日志已清空');
    }, [say]);

    if (!open) {
        return (
            <button type="button" className="ar-debug-fab" onClick={() => setOpen(true)}>
                日志 {logs.length}
            </button>
        );
    }

    return (
        <section className="ar-debug-panel" aria-label="拾光墙调试日志">
            <div className="ar-debug-head">
                <h3>拾光墙日志 · {logs.length}</h3>
                <div className="ar-debug-actions">
                    <button type="button" onClick={handleCopyDiagnostics} disabled={logs.length === 0}>复制诊断</button>
                    <button type="button" onClick={handleClear} disabled={logs.length === 0}>清空</button>
                    <button type="button" onClick={() => setOpen(false)}>关闭</button>
                </div>
            </div>
            <div className="ar-debug-list">
                {displayedLogs.length === 0 ? (
                    <div className="ar-debug-empty">还没有日志。装修、保存、刷新后这里会出现 CollectionWallDebug。</div>
                ) : displayedLogs.map(entry => (
                    <div key={entry.id} className="ar-debug-row">
                        <span className="ar-debug-meta">{new Date(entry.ts).toLocaleTimeString()} · {entry.level}</span>
                        {formatCollectionWallDebugEntrySummary(entry)}
                    </div>
                ))}
            </div>
        </section>
    );
};

/* ============================================================
   Main App
   ============================================================ */

const CollectionHallApp: React.FC = () => {
    const { characters, openApp, closeApp, apiConfig, userProfile, groups, realtimeConfig } = useOS();
    const [books, setBooks] = useState<CollectionBook[]>([]);
    const [walls, setWalls] = useState<CollectionWall[]>([]);
    const [wallItems, setWallItems] = useState<CollectionWallItem[]>([]);
    const [wallAssets, setWallAssets] = useState<CollectionWallAsset[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(0);
    const [drag, setDrag] = useState(0);
    const [selected, setSelected] = useState<CollectionBook | null>(null);
    const [selectedImage, setSelectedImage] = useState<{ entry: WallImageEntry; wallName: string } | null>(null);
    const [activeWall, setActiveWall] = useState<WallScreenState | null>(null);
    const [editingWall, setEditingWall] = useState<{ wall: CollectionWall; entries: WallZoneEntry[] } | null>(null);
    const [pullingId, setPullingId] = useState<string | null>(null);
    const [editing, setEditing] = useState<{ book: CollectionBook; draft: string } | null>(null);
    const [saving, setSaving] = useState(false);
    const [forwardFor, setForwardFor] = useState<CollectionBook | null>(null);
    const [confirmDel, setConfirmDel] = useState<CollectionBook | null>(null);
    const [wallEditorDirty, setWallEditorDirty] = useState(false);
    const [wallEditorSaving, setWallEditorSaving] = useState(false);
    const [invitingWallId, setInvitingWallId] = useState<string | null>(null);
    const [charWallRemark, setCharWallRemark] = useState<{
        wall: CollectionWall;
        entries: WallZoneEntry[];
        charName: string;
        text: string;
    } | null>(null);
    const [pinningRemark, setPinningRemark] = useState(false);
    const [toast, setToast] = useState<{ key: number; msg: string } | null>(null);
    const touch = useRef({ x: 0, y: 0, axis: '' as 'h' | 'v' | '', on: false });

    const charById = useMemo(() => new Map(characters.map(c => [c.id, c])), [characters]);

    const loadBooks = useCallback(async (): Promise<CollectionHallLoadSnapshot> => {
        try {
            const next = await DB.getAllCollectionBooks();
            setBooks(next);
            let nextWalls = await DB.getAllCollectionWalls();
            const itemLists = await Promise.all(nextWalls.map(wall => DB.getCollectionWallItemsByWallId(wall.id)));
            nextWalls.forEach((wall, index) => {
                const itemsForWall = itemLists[index] || [];
                console.info('[CollectionWallDebug] load-before-render', {
                    wallId: wall.id,
                    wallName: wall.name,
                    items: itemsForWall.map((item, itemIndex) => ({
                        index: itemIndex,
                        id: item.id,
                        x: item.x,
                        y: item.y,
                        z: item.z,
                        order: item.order,
                    })),
                });
            });
            let nextWallItems = itemLists.flat();
            const migratedWalls: CollectionWall[] = [];
            const migratedItems: CollectionWallItem[] = [];
            for (const wall of nextWalls) {
                if (wall.layoutMode === 'free') continue;
                const itemsForWall = nextWallItems.filter(item => item.wallId === wall.id);
                debugWallDraftHead('load-migrate-auto-arrange-before', wall.id, itemsForWall);
                const arranged = autoArrangeWallItems(itemsForWall);
                debugWallDraftHead('load-migrate-auto-arrange-after', wall.id, arranged);
                const nextWall = { ...wall, layoutMode: 'free' as const, updatedAt: Date.now() };
                await DB.saveCollectionWall(nextWall);
                await Promise.all(arranged.map(item => DB.saveCollectionWallItem(item)));
                migratedWalls.push(nextWall);
                migratedItems.push(...arranged);
            }
            if (migratedWalls.length > 0) {
                const wallById = new Map(migratedWalls.map(wall => [wall.id, wall]));
                const itemById = new Map(migratedItems.map(item => [item.id, item]));
                nextWalls = nextWalls.map(wall => wallById.get(wall.id) || wall);
                nextWallItems = nextWallItems.map(item => itemById.get(item.id) || item);
            }
            setWalls(nextWalls);
            const cannedCharNotes = nextWallItems.filter(item => (
                item.type === 'text'
                && item.author === 'char'
                && /我看过了。先把这句压在这里，等你下次来。/.test(String(item.text?.content || ''))
            ));
            if (cannedCharNotes.length > 0) {
                await Promise.all(cannedCharNotes.map(item => DB.deleteCollectionWallItem(item.id)));
                nextWallItems = nextWallItems.filter(item => !cannedCharNotes.some(note => note.id === item.id));
            }
            setWallItems(nextWallItems);
            const nextWallAssets = await DB.getAllCollectionWallAssets();
            setWallAssets(nextWallAssets);
            return {
                books: next,
                walls: nextWalls,
                wallItems: nextWallItems,
                wallAssets: nextWallAssets,
            };
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
        if (editingWall && wallEditorSaving) {
            say('正在保存...');
            return;
        }
        if (editingWall && wallEditorDirty && !window.confirm('未保存更改')) return;
        closeApp();
    }, [closeApp, editingWall, say, wallEditorDirty, wallEditorSaving]);

    const refreshActiveWallAfterSave = useCallback(async () => {
        const snapshot = await loadBooks();
        setActiveWall(current => {
            if (!current) return current;
            const freshWall = snapshot.walls.find(candidate => candidate.id === current.wall.id);
            if (!freshWall) return null;
            const { entries } = buildWallZoneEntriesFromItems(freshWall, snapshot.wallItems, snapshot.books, snapshot.wallAssets);
            return { ...current, wall: freshWall, entries };
        });
        return snapshot;
    }, [loadBooks]);

    const sections = useMemo(() => {
        const byChar = new Map<string, CollectionBook[]>();
        for (const b of books) {
            if (!byChar.has(b.charId)) byChar.set(b.charId, []);
            byChar.get(b.charId)!.push(b);
        }
        const wallCharIds = new Set(walls.map(wall => wall.charId).filter(Boolean));
        const orderedIds = [
            ...characters.map(c => c.id).filter(id => byChar.has(id) || wallCharIds.has(id)),
            ...Array.from(byChar.keys()).filter(id => !charById.has(id)),
            ...Array.from(wallCharIds).filter(id => !charById.has(id) && !byChar.has(id)),
        ];
        return orderedIds.map(charId => {
            const charBooks = (byChar.get(charId) || []).sort((a, b) => b.collectedAt - a.collectedAt);
            const character = charById.get(charId);
            const freeform = charBooks.filter(b => b.kind === 'freeform');
            const charWalls = walls
                .filter(wall => wall.charId === charId)
                .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || (a.createdAt || 0) - (b.createdAt || 0));
            const wallBookIds = new Set<string>();
            const wallZones: { wall: CollectionWall; entries: WallZoneEntry[] }[] = charWalls.map(wall => {
                const { entries, wallBookIds: currentWallBookIds } = buildWallZoneEntriesFromItems(wall, wallItems, charBooks, wallAssets);
                currentWallBookIds.forEach(id => wallBookIds.add(id));
                return { wall, entries };
            });
            const looseFreeform = freeform.filter(book => !wallBookIds.has(book.id));
            if (looseFreeform.length > 0) {
                const fallbackWall = charWalls.find(wall => wall.isDefault) || charWalls[0] || {
                    id: `fallback-${charId}`,
                    charId,
                    name: '未分类',
                    isDefault: true,
                    layoutMode: 'free',
                    background: { type: 'color', value: '#17120e', fit: 'cover', dim: 0.18 },
                    allowCharDecorate: true,
                    changeCountSinceVisit: 0,
                    charRemarks: [],
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

    const handleInviteChar = useCallback(async (
        wall: CollectionWall,
        entries: WallZoneEntry[],
        charName: string,
        trigger: CollectionWallVisitTrigger = 'invite',
    ): Promise<CharWallOrbReply | null> => {
        if (!wall.allowCharDecorate) {
            say('这面墙暂时不让 TA 布置');
            return null;
        }
        if (wall.id.startsWith('fallback-')) {
            say('先把这面墙保存一下，再邀请 TA 来');
            return null;
        }
        const char = charById.get(wall.charId);
        if (!char) {
            say('找不到这面墙对应的角色');
            return null;
        }
        if (!apiConfig?.baseUrl || !apiConfig?.model) {
            say('先配置主 API');
            return null;
        }
        setInvitingWallId(wall.id);
        try {
            const latestWall = await DB.getCollectionWallById(wall.id);
            const wallForPrompt = latestWall || wall;
            const { messages, manifest } = await buildCharWallVisitMessages({
                char,
                userProfile,
                groups,
                realtimeConfig,
                apiConfig,
                wall: wallForPrompt,
                entries,
                trigger,
            });
            const result = await requestCharWallNote({
                apiConfig,
                messages,
                charName,
            });
            if (result.action !== 'note') {
                say('TA 看了看，没说什么');
                return null;
            }
            const now = Date.now();
            const wallForPatch = await DB.getCollectionWallById(wall.id) || wallForPrompt;
            const previousRemarks = (wallForPatch.charRemarks || []).map(remark => remark.text);
            if (isDuplicateCharWallRemark(result.content, previousRemarks.slice(-10))) {
                say('TA 刚才已经说过类似的话了，戳他换个角度再试试');
                return null;
            }
            const updatedWall = await DB.saveCollectionWall({
                ...wallForPatch,
                charRemarks: [...(wallForPatch.charRemarks || []), { text: result.content, ts: now }].slice(-30),
                charLastVisitManifest: JSON.stringify(manifest),
                hasUnseenCharItem: false,
                charLastVisitAt: now,
                changeCountSinceVisit: 0,
            });
            const snapshot = await loadBooks();
            const freshWall = snapshot.walls.find(candidate => candidate.id === updatedWall.id) || updatedWall;
            const built = buildWallZoneEntriesFromItems(freshWall, snapshot.wallItems, snapshot.books, snapshot.wallAssets);
            setActiveWall(current => {
                if (!current || current.wall.id !== updatedWall.id) return current;
                return { ...current, wall: freshWall, entries: built.entries };
            });
            return { wall: freshWall, entries: built.entries, charName, text: result.content };
        } catch (error) {
            console.error('[CollectionHall] char note failed:', error);
            say('TA 看了看，没说什么');
            return null;
        } finally {
            setInvitingWallId(null);
        }
    }, [apiConfig, charById, groups, loadBooks, realtimeConfig, say, userProfile]);

    const pinWallRemark = useCallback(async (reply: CharWallOrbReply) => {
        if (pinningRemark) return;
        setPinningRemark(true);
        try {
            const latestWall = await DB.getCollectionWallById(reply.wall.id);
            const wall = latestWall || reply.wall;
            const items = await DB.getCollectionWallItemsByWallId(wall.id);
            const noteItem = buildCharWallNoteItem({
                wallId: wall.id,
                layoutMode: wall.layoutMode,
                items,
                content: reply.text,
                charName: reply.charName,
                anchorItem: getRecentAnchorItem(reply.entries),
                remarkTemplate: pickCharRemarkTemplate(reply.text).pick,
            });
            await DB.saveCollectionWallItem(noteItem);
            await DB.saveCollectionWall({
                ...wall,
                hasUnseenCharItem: false,
                charLastVisitAt: Date.now(),
                changeCountSinceVisit: 0,
            });
            say('已钉到拾光墙');
            const snapshot = await loadBooks();
            setActiveWall(current => {
                if (!current || current.wall.id !== wall.id) return current;
                const freshWall = snapshot.walls.find(candidate => candidate.id === wall.id) || wall;
                const built = buildWallZoneEntriesFromItems(freshWall, snapshot.wallItems, snapshot.books, snapshot.wallAssets);
                return { ...current, wall: freshWall, entries: built.entries };
            });
        } catch (error) {
            console.error('[CollectionHall] pin char remark failed:', error);
            say('钉到墙上失败，稍后再试');
        } finally {
            setPinningRemark(false);
        }
    }, [loadBooks, pinningRemark, say]);

    const handlePinCharRemark = useCallback(async () => {
        if (!charWallRemark || pinningRemark) return;
        await pinWallRemark(charWallRemark);
        setCharWallRemark(null);
    }, [charWallRemark, pinWallRemark, pinningRemark]);

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
                                <CharacterArchivePage
                                    key={char.id}
                                    char={char}
                                    hue={hue}
                                    afterglow={afterglow}
                                    heartTalks={heartTalks}
                                    freeform={freeform}
                                    wallZones={wallZones}
                                    pullingId={pullingId}
                                    onPickBook={pick}
                                    onOpenWall={(wall, entries, charName) => setActiveWall({ wall, entries, charName })}
                                />
                            ))}
                        </div>
                    </div>
                </>
            )}

            {activeWall && (
                <FullScreenLightWall
                    wall={activeWall.wall}
                    entries={activeWall.entries}
                    libraryAssets={wallAssets}
                    userName={userProfile?.name || '你'}
                    userAvatar={userProfile?.avatar}
                    charName={activeWall.charName}
                    charAvatar={charById.get(activeWall.wall.charId)?.avatar}
                    inviting={invitingWallId === activeWall.wall.id}
                    pinningRemark={pinningRemark}
                    onClose={() => setActiveWall(null)}
                    onPickBook={book => setSelected(book)}
                    onPickImage={(entry, wallName) => setSelectedImage({ entry, wallName })}
                    onInviteChar={handleInviteChar}
                    onPinCharRemark={pinWallRemark}
                    onSaved={refreshActiveWallAfterSave}
                    onAssetsChanged={loadBooks}
                    say={say}
                />
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
                    onSaved={loadBooks}
                    onDirtyChange={setWallEditorDirty}
                    onSavingChange={setWallEditorSaving}
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

            {charWallRemark && (
                <CharRemarkPopup
                    remark={charWallRemark}
                    avatarUrl={charById.get(charWallRemark.wall.charId)?.avatar}
                    pinning={pinningRemark}
                    onClose={() => setCharWallRemark(null)}
                    onPin={handlePinCharRemark}
                />
            )}

            <CollectionWallDebugPanel say={say} />
            {toast && <div className="ar-toast" key={toast.key}>{toast.msg}</div>}
        </div>
    );
};

export default CollectionHallApp;

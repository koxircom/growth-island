import React from "react";
import {it,expect} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {writeFileSync,mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import sharp from "sharp";
import {RewardArt} from "../app/reward-art";
it("renders all illustration categories with fixed geometry and no external images",async()=>{
  const names=["看电视","Switch 游戏","读书","画画","公园野餐","冰淇淋","积木玩具","听音乐","特别惊喜","生日蛋糕"];
  const svgs=names.map((name)=>{
    const markup=renderToStaticMarkup(<RewardArt reward={{name}}/>);
    expect(markup).toContain('viewBox="0 0 220 130"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain("<img");
    return markup.slice(markup.indexOf("<svg"),markup.indexOf("</svg>")+6).replace(/style="[^"]*"/,"");
  });
  const board='<svg xmlns="http://www.w3.org/2000/svg" width="660" height="520" viewBox="0 0 660 520"><rect width="660" height="520" fill="#f7ead6"/>'+svgs.map((s,i)=>'<g transform="translate('+((i%3)*220)+','+(Math.floor(i/3)*130)+')">'+s+'</g>').join("")+'</svg>';
  const dir=mkdtempSync(join(tmpdir(),"island-reward-preview-"));
  try {
    const png=await sharp(Buffer.from(board)).png().toBuffer();
    expect(png.length).toBeGreaterThan(1000);
    writeFileSync(join(dir,"preview.svg"),board);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

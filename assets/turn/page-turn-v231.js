import {PageFlip} from './page-flip-2.0.7.js';

// Only two disposable page images exist during a turn; the reader remains canonical.
export function createTurn({before,after,box,direction,gesture,onFinish}) {
  const layer=document.createElement('div');layer.className='page-turn-layer';
  layer.setAttribute('aria-hidden','true');layer.inert=true;
  Object.assign(layer.style,{left:box.left+'px',top:box.top+'px',width:box.width+'px',height:box.height+'px'});
  layer.style.setProperty('--page-width',box.width+'px');
  document.body.append(layer);
  const engine=new PageFlip(layer,{width:box.width,height:box.height,size:'fixed',usePortrait:true,autoSize:false,
    startPage:direction>0?0:1,flippingTime:460,drawShadow:true,maxShadowOpacity:document.documentElement.hasAttribute('data-night')?.12:.16,
    useMouseEvents:false,showPageCorners:false,mobileScrollSupport:false,clickEventForward:false});
  let disposed=false,changed=false,armed=false,lastPoint,frame,timeout;
  const finish=complete=>{
    if(disposed)return;disposed=true;cancelAnimationFrame(frame);clearTimeout(timeout);
    engine.off('flip');engine.off('changeState');engine.destroy();onFinish(complete);
  };
  try {engine.loadFromHTML(direction>0?[before,after]:[after,before]);}
  catch(error){finish(false);throw error;}
  engine.on('flip',()=>{if(armed)changed=true;});
  engine.on('changeState',event=>{if(armed&&event.data==='read')frame=requestAnimationFrame(()=>finish(changed));});
  const point=(dx,y)=>({x:direction>0?box.width-2+dx:2+dx,y:Math.max(1,Math.min(box.height-2,y))});
  if(!gesture)frame=requestAnimationFrame(()=>{
    if(disposed)return;armed=true;
    direction>0?engine.flipNext('bottom'):engine.flipPrev('bottom');
    timeout=setTimeout(()=>finish(true),900);
  });
  return {
    move(dx,y){
      if(disposed)return;
      if(!armed){armed=true;engine.startUserTouch(point(0,y));}
      lastPoint=point(dx,y);engine.userMove(lastPoint,true);
    },
    release(complete){
      if(disposed)return;
      if(!armed||!lastPoint){finish(false);return;}
      engine.userStop(lastPoint,true);engine.getFlipController().stopMove(complete);
      timeout=setTimeout(()=>finish(complete),900);
    },
    cancel(){finish(false);}
  };
}

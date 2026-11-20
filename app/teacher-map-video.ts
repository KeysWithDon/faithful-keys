export type RecordedMap = {
  width: number;
  height: number;
  key: string;
  mode: 'keys' | 'spectrum';
  lanes: {x: number; y: number; width: number; height: number; color: string; label: string; description: string}[];
  nodes: {key: string; x: number; y: number; color: string; root: string; suffix: string; role: string; selected: boolean}[];
  edges: {d: string; endX: number; endY: number; angle: number; color: string; active: boolean; route: boolean}[];
};

const paths = new WeakMap<RecordedMap, Path2D[]>();

export function drawRecordedMap(ctx: CanvasRenderingContext2D, map: RecordedMap, nodeFlashes: ReadonlyMap<string,number>) {
  const scale=Math.min(1160/map.width,420/map.height);
  ctx.save();
  ctx.translate((1280-map.width*scale)/2,86+(420-map.height*scale)/2);
  ctx.scale(scale,scale);
  ctx.textAlign='left';
  for(const lane of map.lanes){
    ctx.fillStyle=lane.color;
    ctx.globalAlpha=.09;
    ctx.fillRect(lane.x,lane.y,lane.width,lane.height);
    ctx.globalAlpha=1;
    ctx.font='700 23px system-ui';
    ctx.fillText(lane.label,lane.x+12,lane.y+29);
    ctx.font='14px system-ui';
    ctx.fillText(lane.description,lane.x+12,lane.y+50);
  }
  let geometry=paths.get(map);
  if(!geometry){
    geometry=map.edges.map(edge=>new Path2D(edge.d));
    paths.set(map,geometry);
  }
  for(const foreground of [false,true]){
    map.edges.forEach((edge,index)=>{
      if((edge.active||edge.route)!==foreground)return;
      ctx.globalAlpha=edge.active ? 1 : edge.route ? .9 : map.mode==='keys' ? .50 : .42;
      ctx.strokeStyle=edge.color;
      ctx.lineWidth=(edge.active?3:edge.route?2:1.05)/scale;
      ctx.setLineDash(edge.route?[7/scale,5/scale]:[]);
      ctx.stroke(geometry[index]);
      if(foreground){
        const tail=9/scale;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(edge.endX-tail*Math.cos(edge.angle-.52),edge.endY-tail*Math.sin(edge.angle-.52));
        ctx.lineTo(edge.endX,edge.endY);
        ctx.lineTo(edge.endX-tail*Math.cos(edge.angle+.52),edge.endY-tail*Math.sin(edge.angle+.52));
        ctx.stroke();
      }
    });
  }
  ctx.globalAlpha=1;
  ctx.setLineDash([]);
  ctx.textAlign='center';
  for(const node of map.nodes){
    ctx.beginPath();
    ctx.arc(node.x,node.y,33,0,Math.PI*2);
    ctx.fillStyle=node.selected?'#253244':'#10151f';
    ctx.fill();
    ctx.strokeStyle=node.color;
    ctx.lineWidth=node.selected?4:2;
    ctx.stroke();
    const flash=nodeFlashes.get(node.key)??0;
    if(flash>0){
      ctx.globalAlpha=flash*.75;
      ctx.fillStyle='#ffe7a4';
      ctx.fill();
      ctx.globalAlpha=1;
    }
    ctx.font='700 23px system-ui';
    ctx.fillStyle=flash>.45?'#10151f':node.color;
    ctx.fillText(node.root,node.x,node.y-3,62);
    ctx.font='14px system-ui';
    ctx.fillText(node.suffix,node.x,node.y+17,61);
    if(node.role){
      ctx.font='700 15px system-ui';
      ctx.fillStyle='#e6edf2';
      ctx.fillText(node.role,node.x,node.y+51,84);
    }
  }
  ctx.restore();
}

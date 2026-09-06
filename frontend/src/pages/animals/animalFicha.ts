import { formatAge, formatDate, formatNumber, humanizeCode } from '../../utils';

export interface AnimalFichaData {
  nombre:string;
  codigoArete?:string|null;
  descripcion?:string|null;
  fotoPerfil?:string|null;
  fotoPortada?:string|null;
  especie?:string|null;
  sexo?:string|null;
  fechaNacimiento?:string|null;
  estado?:string|null;
  origen?:string|null;
  razas?:Array<{nombre:string;porcentaje?:number|string|null}>;
  colores?:Array<{nombre:string}>;
  peso?:{peso_kg:number|string;fecha:string}|null;
  madre?:string|null;
  padre?:string|null;
  totalPartos?:number|null;
  totalCrias?:number|null;
  prenezConfirmada?:boolean;
  marquilla?:string|null;
}

type FichaFormat='png'|'pdf';
const WIDTH=1240;
const HEIGHT=1754;

function roundedRect(ctx:CanvasRenderingContext2D,x:number,y:number,width:number,height:number,radius:number){
  const r=Math.min(radius,width/2,height/2);
  ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+width,y,x+width,y+height,r);ctx.arcTo(x+width,y+height,x,y+height,r);ctx.arcTo(x,y+height,x,y,r);ctx.arcTo(x,y,x+width,y,r);ctx.closePath();
}

function lines(ctx:CanvasRenderingContext2D,value:string,maxWidth:number,maxLines=3){
  const words=value.trim().split(/\s+/);const result:string[]=[];let current='';
  for(const word of words){const next=current?`${current} ${word}`:word;if(ctx.measureText(next).width<=maxWidth||!current)current=next;else{result.push(current);current=word;if(result.length===maxLines-1)break;}}
  if(current&&result.length<maxLines)result.push(current);
  if(result.length===maxLines&&words.join(' ').length<value.length)result[maxLines-1]+='…';
  return result;
}

function drawField(ctx:CanvasRenderingContext2D,x:number,y:number,width:number,label:string,value:string){
  roundedRect(ctx,x,y,width,132,24);ctx.fillStyle='#ffffff';ctx.fill();ctx.strokeStyle='#d9e8df';ctx.lineWidth=2;ctx.stroke();
  ctx.fillStyle='#718077';ctx.font='500 25px sans-serif';ctx.fillText(label,x+28,y+40);
  ctx.fillStyle='#183025';ctx.font='700 31px sans-serif';
  const rows=lines(ctx,value||'—',width-56,2);rows.forEach((row,index)=>ctx.fillText(row,x+28,y+82+index*35));
}

async function loadPicture(url?:string|null){
  if(!url)return null;
  try{
    const response=await fetch(url,{cache:'force-cache'});
    if(response.ok){
      const localUrl=URL.createObjectURL(await response.blob());
      const picture=await new Promise<HTMLImageElement|null>((resolve)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>resolve(null);image.src=localUrl;});
      URL.revokeObjectURL(localUrl);
      if(picture)return picture;
    }
  }catch{/* Se intenta la carga directa como compatibilidad web. */}
  return new Promise<HTMLImageElement|null>((resolve)=>{const image=new Image();image.crossOrigin='anonymous';image.onload=()=>resolve(image);image.onerror=()=>resolve(null);image.src=url;});
}

function drawCoverPicture(ctx:CanvasRenderingContext2D,picture:HTMLImageElement,x:number,y:number,width:number,height:number){
  const scale=Math.max(width/picture.naturalWidth,height/picture.naturalHeight);
  const renderedWidth=picture.naturalWidth*scale;const renderedHeight=picture.naturalHeight*scale;
  ctx.drawImage(picture,x+(width-renderedWidth)/2,y+(height-renderedHeight)/2,renderedWidth,renderedHeight);
}

function drawFittedText(ctx:CanvasRenderingContext2D,value:string,x:number,y:number,maxWidth:number){
  let size=54;do{ctx.font=`800 ${size}px sans-serif`;size-=2;}while(size>=34&&ctx.measureText(value).width>maxWidth);
  ctx.fillText(value,x,y);
}

async function fichaCanvas(animal:AnimalFichaData){
  const canvas=document.createElement('canvas');canvas.width=WIDTH;canvas.height=HEIGHT;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('El dispositivo no pudo preparar la ficha.');
  ctx.fillStyle='#f3f8f5';ctx.fillRect(0,0,WIDTH,HEIGHT);
  ctx.fillStyle='#10251c';ctx.fillRect(0,0,WIDTH,286);
  ctx.fillStyle='#44cb88';ctx.font='800 42px sans-serif';ctx.fillText('SGB',72,88);
  ctx.fillStyle='#ffffff';ctx.font='800 58px sans-serif';ctx.fillText('Ficha del animal',72,164);
  ctx.fillStyle='#aec2b7';ctx.font='400 27px sans-serif';ctx.fillText('Sistema de Gestión Bovina',72,214);

  const [picture,coverPicture]=await Promise.all([loadPicture(animal.fotoPerfil),loadPicture(animal.fotoPortada)]);
  const photoX=72,photoY=238,photoSize=286;
  roundedRect(ctx,photoX,photoY,photoSize,photoSize,42);ctx.fillStyle='#dff3e7';ctx.fill();ctx.save();roundedRect(ctx,photoX,photoY,photoSize,photoSize,42);ctx.clip();
  if(picture){drawCoverPicture(ctx,picture,photoX,photoY,photoSize,photoSize);}else{ctx.fillStyle='#2c9d66';ctx.font='800 112px sans-serif';ctx.textAlign='center';ctx.fillText(animal.nombre.slice(0,1).toUpperCase(),photoX+photoSize/2,photoY+184);ctx.textAlign='left';}ctx.restore();
  ctx.strokeStyle='#ffffff';ctx.lineWidth=10;roundedRect(ctx,photoX,photoY,photoSize,photoSize,42);ctx.stroke();

  ctx.fillStyle='#173126';drawFittedText(ctx,animal.nombre,398,374,420);
  ctx.fillStyle='#60736a';ctx.font='500 27px sans-serif';ctx.fillText(animal.codigoArete?`Arete ${animal.codigoArete}`:'Sin arete registrado',398,421);
  roundedRect(ctx,398,452,240,52,26);ctx.fillStyle='#dff3e7';ctx.fill();ctx.fillStyle='#187d50';ctx.font='700 24px sans-serif';ctx.fillText(humanizeCode(animal.estado||'ACTIVO'),424,486);
  if(coverPicture){const coverX=846,coverY=304,coverWidth=322,coverHeight=220;roundedRect(ctx,coverX,coverY,coverWidth,coverHeight,28);ctx.fillStyle='#dfece5';ctx.fill();ctx.save();roundedRect(ctx,coverX,coverY,coverWidth,coverHeight,28);ctx.clip();drawCoverPicture(ctx,coverPicture,coverX,coverY,coverWidth,coverHeight);const shade=ctx.createLinearGradient(0,coverY+145,0,coverY+coverHeight);shade.addColorStop(0,'rgba(0,0,0,0)');shade.addColorStop(1,'rgba(0,0,0,.68)');ctx.fillStyle=shade;ctx.fillRect(coverX,coverY,coverWidth,coverHeight);ctx.restore();ctx.fillStyle='#ffffff';ctx.font='700 21px sans-serif';ctx.fillText('Última foto de portada',coverX+20,coverY+coverHeight-20);}

  const breed=animal.razas?.length?animal.razas.map((item)=>`${item.nombre}${item.porcentaje!=null?` ${formatNumber(item.porcentaje)}%`:''}`).join(', '):'Sin registrar';
  const colors=animal.colores?.length?animal.colores.map((item)=>item.nombre).join(', '):'Sin registrar';
  const parents=[animal.madre?`Madre: ${animal.madre}`:null,animal.padre?`Padre: ${animal.padre}`:null].filter(Boolean).join(' · ')||'Sin registrar';
  const weight=animal.peso?`${formatNumber(animal.peso.peso_kg)} kg · ${formatDate(animal.peso.fecha)}`:'Sin registrar';
  const birth=animal.fechaNacimiento?`${formatDate(animal.fechaNacimiento)} · ${formatAge(animal.fechaNacimiento)}`:'Sin registrar';
  const reproduction=animal.sexo==='HEMBRA'?[animal.prenezConfirmada?'Preñez confirmada':null,animal.totalPartos!=null?`${animal.totalPartos} parto${animal.totalPartos===1?'':'s'}`:null,animal.totalCrias!=null?`${animal.totalCrias} cría${animal.totalCrias===1?'':'s'}`:null].filter(Boolean).join(' · ')||'Sin registros':animal.totalCrias!=null?`${animal.totalCrias} cría${animal.totalCrias===1?'':'s'} registrada${animal.totalCrias===1?'':'s'}`:'Sin registros';
  const fields:[string,string][]=[['Especie y sexo',[animal.especie,animal.sexo==='HEMBRA'?'Hembra':animal.sexo==='MACHO'?'Macho':null].filter(Boolean).join(' · ')||'—'],['Nacimiento y edad',birth],['Raza',breed],['Color',colors],['Último peso',weight],['Padres',parents],['Origen',animal.origen||'Sin registrar'],['Resumen reproductivo',reproduction],['Fierro o marquilla',animal.marquilla||'Sin registrar']];
  let y=566;for(let index=0;index<fields.length;index+=1){const column=index%2;const row=Math.floor(index/2);drawField(ctx,72+column*558,y+row*154,column===0&&index===fields.length-1?1096:522,fields[index][0],fields[index][1]);}
  y+=Math.ceil(fields.length/2)*154+12;
  if(animal.descripcion){roundedRect(ctx,72,y,1096,170,24);ctx.fillStyle='#ffffff';ctx.fill();ctx.strokeStyle='#d9e8df';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle='#718077';ctx.font='500 25px sans-serif';ctx.fillText('Descripción',100,y+40);ctx.fillStyle='#183025';ctx.font='500 28px sans-serif';lines(ctx,animal.descripcion,1040,3).forEach((row,index)=>ctx.fillText(row,100,y+82+index*34));}
  ctx.fillStyle='#718077';ctx.font='400 22px sans-serif';ctx.fillText(`Ficha generada el ${new Intl.DateTimeFormat('es-EC',{dateStyle:'long'}).format(new Date())}`,72,HEIGHT-60);
  ctx.textAlign='right';ctx.fillText('Información proporcionada por SGB',WIDTH-72,HEIGHT-60);ctx.textAlign='left';
  return canvas;
}

function canvasBlob(canvas:HTMLCanvasElement,type:string,quality?:number){return new Promise<Blob>((resolve,reject)=>canvas.toBlob((blob)=>blob?resolve(blob):reject(new Error('No se pudo generar el archivo.')),type,quality));}
function bytes(value:string){return new TextEncoder().encode(value);}
function join(parts:Uint8Array[]){const size=parts.reduce((sum,item)=>sum+item.length,0);const output=new Uint8Array(size);let offset=0;for(const part of parts){output.set(part,offset);offset+=part.length;}return output;}

async function pdfBlob(canvas:HTMLCanvasElement){
  const jpeg=await canvasBlob(canvas,'image/jpeg',.92);const image=new Uint8Array(await jpeg.arrayBuffer());
  const objects:Uint8Array[]=[
    bytes('<< /Type /Catalog /Pages 2 0 R >>'),
    bytes('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    bytes('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'),
    join([bytes(`<< /Type /XObject /Subtype /Image /Width ${WIDTH} /Height ${HEIGHT} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`),image,bytes('\nendstream')]),
    bytes('<< /Length 31 >>\nstream\nq\n595 0 0 842 0 0 cm\n/Im0 Do\nQ\nendstream'),
  ];
  const parts=[new Uint8Array([37,80,68,70,45,49,46,52,10,37,226,227,207,211,10])];const offsets=[0];let position=parts[0].length;
  objects.forEach((object,index)=>{offsets.push(position);const wrapped=join([bytes(`${index+1} 0 obj\n`),object,bytes('\nendobj\n')]);parts.push(wrapped);position+=wrapped.length;});
  const xref=position;let table=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;for(let index=1;index<offsets.length;index+=1)table+=`${String(offsets[index]).padStart(10,'0')} 00000 n \n`;table+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  parts.push(bytes(table));return new Blob([join(parts)],{type:'application/pdf'});
}

function safeFilename(value:string){return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'')||'animal';}
async function blobDataUrl(blob:Blob){return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});}
async function save(blob:Blob,filename:string){
  if(window.SGBAndroid?.saveBase64File){const stored=window.SGBAndroid.saveBase64File(await blobDataUrl(blob),filename,blob.type);if(stored)return;}
  const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),10_000);
}

export async function downloadAnimalFicha(animal:AnimalFichaData,format:FichaFormat){
  const canvas=await fichaCanvas(animal);const filename=`Ficha-${safeFilename(animal.nombre)}.${format}`;
  const blob=format==='png'?await canvasBlob(canvas,'image/png'):await pdfBlob(canvas);await save(blob,filename);
}

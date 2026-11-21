(async()=>{
 const grid=document.querySelector('#grid'),q=document.querySelector('#q'),cat=document.querySelector('#category'),count=document.querySelector('#count'),empty=document.querySelector('#empty'),viewer=document.querySelector('#viewer'),large=document.querySelector('#large'),skuEl=document.querySelector('#viewsku'),pos=document.querySelector('#position'),prev=document.querySelector('#prev'),next=document.querySelector('#next');
 let products=[],shown=[],active=null,index=0,lastFocus=null,touchX=0;
 try{
  const response=await fetch('/catalog/settings.json',{cache:'no-cache'});
  if(response.ok){
   const settings=await response.json();
   const title=typeof settings.site_name==='string'?settings.site_name.trim():'';
   if(title){document.title=title;document.querySelector('.brand a').textContent=title;document.querySelector('.intro h1').textContent=title;}
   if(settings.site_description)document.querySelector('.intro p').textContent=settings.site_description;
   if(typeof settings.logo_url==='string'&&/^https:\/\//i.test(settings.logo_url)){
    const logo=document.createElement('img');logo.src=settings.logo_url;logo.alt=title?title+' 標誌':'網站標誌';logo.className='site-logo';logo.loading='lazy';logo.referrerPolicy='no-referrer';document.querySelector('.brand').prepend(logo);
   }
   if(/^#[0-9a-fA-F]{6}$/.test(settings.brand_color||''))document.documentElement.style.setProperty('--brand',settings.brand_color);
   if(settings.noindex==='false')document.querySelector('meta[name="robots"]')?.setAttribute('content','index,follow');
   const url=settings.contact_url;
   if(settings.contact_text&&typeof url==='string'&&/^https?:\/\//.test(url)){
    const link=document.createElement('a');link.href=url;link.textContent=settings.contact_text;link.rel='noopener noreferrer';link.target='_blank';document.querySelector('.intro').append(link);
   }
  }
 }catch{/* Site stays readable if settings are temporarily unavailable. */}
 try{const r=await fetch('/catalog/products.json',{cache:'no-cache'});if(!r.ok)throw Error('catalog');products=await r.json();}catch(e){count.textContent='產品資料暫時無法載入。';return;}
 [...new Set(products.map(p=>p.category).filter(Boolean))].sort().forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;cat.append(o)});
 function filter(){const term=q.value.trim().toLocaleLowerCase();shown=products.filter(p=>(!cat.value||p.category===cat.value)&&(!term||[p.sku,p.name,p.keywords,p.series].join(' ').toLocaleLowerCase().includes(term)));render();}
 function render(){grid.replaceChildren();count.textContent=`共 ${shown.length} 款產品`;empty.hidden=shown.length!==0;for(const p of shown){const card=document.createElement('article');card.className='item';const button=document.createElement('button');button.className='cover';button.type='button';button.setAttribute('aria-label',`放大檢視 ${p.sku} 照片`);const img=document.createElement('img');img.loading='lazy';if(p.images?.length){img.src=p.images[0].thumb||p.images[0].src;img.alt=p.images[0].alt||p.name;button.append(img);button.addEventListener('click',()=>openViewer(p,0,button));}else{button.classList.add('no-photo');button.textContent='照片準備中';button.disabled=true;}const info=document.createElement('div');info.className='info';const sku=document.createElement('div');sku.className='sku';sku.textContent=p.sku;const name=document.createElement('div');name.className='name';name.textContent=p.name;info.append(sku,name);card.append(button,info);grid.append(card);}}
 function setImage(){const im=active.images[index];large.src=im.src||im.display||im.thumb;large.alt=im.alt||active.name;skuEl.textContent=active.sku;pos.textContent=`${index+1} / ${active.images.length}`;prev.disabled=index===0;next.disabled=index===active.images.length-1;[index-1,index+1].filter(i=>i>=0&&i<active.images.length).forEach(i=>{const pre=new Image();pre.src=active.images[i].src;});}
 function openViewer(p,i,focus){active=p;index=i;lastFocus=focus;viewer.hidden=false;document.body.style.overflow='hidden';setImage();document.querySelector('#close').focus();}
 function closeViewer(){viewer.hidden=true;document.body.style.overflow='';large.removeAttribute('src');if(lastFocus)lastFocus.focus();}
 function move(n){if(!active)return;const target=Math.max(0,Math.min(active.images.length-1,index+n));if(target===index)return;index=target;setImage();}
 q.addEventListener('input',filter);cat.addEventListener('change',filter);prev.addEventListener('click',()=>move(-1));next.addEventListener('click',()=>move(1));document.querySelector('#close').addEventListener('click',closeViewer);viewer.addEventListener('click',e=>{if(e.target===viewer)closeViewer()});
 document.addEventListener('keydown',e=>{if(viewer.hidden)return;if(e.key==='Escape')closeViewer();if(e.key==='ArrowLeft')move(-1);if(e.key==='ArrowRight')move(1)});
 viewer.addEventListener('touchstart',e=>{touchX=e.changedTouches[0].clientX},{passive:true});viewer.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-touchX;if(Math.abs(dx)>45)move(dx<0?1:-1)},{passive:true});
 document.querySelector('#cols').addEventListener('click',()=>grid.classList.toggle('two'));filter();
})();

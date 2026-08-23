'use strict';

module.exports=async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  var authorization=String(req.headers.authorization||''),userToken=authorization.startsWith('Bearer ')?authorization.slice(7):'';
  if(!userToken)return res.status(401).json({error:'Authentication required'});
  var supabaseUrl=String(process.env.SUPABASE_URL||'').replace(/\/$/,''),supabaseKey=process.env.SUPABASE_ANON_KEY||process.env.SUPABASE_SERVICE_KEY;
  if(!supabaseUrl||!supabaseKey)return res.status(500).json({error:'Authentication service is not configured'});
  try{
    var userResponse=await fetch(supabaseUrl+'/auth/v1/user',{headers:{apikey:supabaseKey,Authorization:'Bearer '+userToken}});
    if(!userResponse.ok)return res.status(401).json({error:'Invalid session'});
    var body=req.body||{},name=String(body.name||'document'),buffer=Buffer.from(String(body.data||''),'base64'),text='';
    if(!buffer.length||buffer.length>4*1024*1024)return res.status(400).json({error:'Document must be between 1 byte and 4 MB'});
    if(/\.pdf$/i.test(name)){var pdf=require('pdf-parse');var parsed=await pdf(buffer);text=parsed.text||'';}
    else if(/\.docx$/i.test(name)){var mammoth=require('mammoth');var doc=await mammoth.extractRawText({buffer:buffer});text=doc.value||'';}
    else return res.status(400).json({error:'Supported uploads are PDF, DOCX, TXT, MD, CSV and JSON'});
    text=String(text).replace(/\u0000/g,'').trim();if(text.length<20)return res.status(422).json({error:'No readable text was found'});
    return res.status(200).json({name:name,text:text.slice(0,120000),characters:text.length});
  }catch(e){console.error('document extraction',e);return res.status(422).json({error:'The document could not be read. Confirm it is not encrypted or image-only.'});}
};

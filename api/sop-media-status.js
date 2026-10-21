// This deployment has no transcription/action-recognition worker or ingestion route.
// Report implemented capabilities, not merely the presence of an environment secret.
module.exports = async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(String(req.method||'GET').toUpperCase()!=='GET')return res.status(405).json({error:'GET only'});
  return res.status(200).json({available:false,status:'not_implemented',transcription:false,actionRecognition:false,serverVideoUpload:false,manualSteps:true,localFrameExtraction:true,message:'Automatic transcription and action recognition are unavailable in this deployment. Use local frame extraction or write steps manually. Selected videos remain in your browser.'});
};

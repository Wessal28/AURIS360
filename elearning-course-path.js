(function(){
  'use strict';
  var legacyNew=window.elcNew;
  var legacyEdit=window.elcEdit;
  var legacyFullBody=window.elcFullBody;
  var pathDraft=[];
  var quizDraft={enabled:true,questions:[]};

  function uid(prefix){return prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);}
  function cleanPath(value){
    var rows=Array.isArray(value)?value:[];
    return rows.map(function(x,i){return {id:String(x.id||uid('lesson')),sequence:i+1,title:String(x.title||('Video '+(i+1))).trim(),video_url:String(x.video_url||x.url||'').trim(),duration_minutes:Number(x.duration_minutes||0)||null};}).filter(function(x){return x.video_url;});
  }
  function cleanQuiz(value,course){
    value=value&&typeof value==='object'?value:{};
    var questions=Array.isArray(value.questions)?value.questions:[];
    return {enabled:value.enabled!==false&&questions.length>0,passing_score:Number(value.passing_score||course?.passing_score||80)||80,questions:questions.map(function(q,i){return {id:String(q.id||uid('question')),sequence:i+1,prompt:String(q.prompt||'').trim(),options:(Array.isArray(q.options)?q.options:[]).map(String).filter(Boolean),correct_index:Number(q.correct_index||0),explanation:String(q.explanation||'').trim()};}).filter(function(q){return q.prompt&&q.options.length>=2;})};
  }
  function coursePath(course){
    var rows=cleanPath(course?.learning_path);
    if(!rows.length&&course?.course_url)rows=[{id:'legacy-video',sequence:1,title:course.title||'Course video',video_url:course.course_url,duration_minutes:course.duration_minutes||null}];
    return rows;
  }
  function courseQuiz(course){return cleanQuiz(course?.quiz_config,course);}
  function youtubeEmbedUrl(value){
    try{
      var url=new URL(String(value||''),location.origin),host=url.hostname.toLowerCase(),id='';
      if(host==='youtu.be')id=url.pathname.slice(1).split('/')[0];
      else if(host==='www.youtube.com'||host==='youtube.com'||host==='www.youtube-nocookie.com'){
        if(url.pathname==='/watch')id=url.searchParams.get('v')||'';
        else if(url.pathname.indexOf('/embed/')===0)id=url.pathname.split('/')[2]||'';
      }
      return /^[A-Za-z0-9_-]{11}$/.test(id)?'https://www.youtube-nocookie.com/embed/'+id+'?rel=0&modestbranding=1':'';
    }catch(_){return '';}
  }
  window.eleCoursePath=coursePath;
  window.eleCourseQuiz=courseQuiz;

  function ensureBuilder(){
    var legacy=document.getElementById('elcf-url');if(!legacy||document.getElementById('elc-course-path'))return;
    var group=legacy.closest('.form3group');if(group){
      var label=group.querySelector('.form3label');if(label)label.textContent='Legacy single video / external LMS link';
      group.querySelector('.muted')?.insertAdjacentHTML('beforebegin','<div class="muted elc-legacy-video-note">Existing single-video courses continue to use this link. New courses should use the structured video path below.</div>');
    }
    var card=document.createElement('div');card.id='elc-course-path';card.className='elc-path-card';
    card.innerHTML='<div class="elc-path-head"><div><div class="elc-path-title">Course videos and final quiz</div><div class="elc-path-sub">Add short videos in viewing order. Learners complete them before the final quiz is unlocked.</div></div><button type="button" class="btn btn-sm" data-auris-module-onclick="b0043"><i class="ti ti-plus"></i>Add video</button></div><div id="elc-path-lessons"></div><div class="elc-path-head elc-quiz-head"><div><div class="elc-path-title">Final quiz</div><div class="elc-path-sub">The pass mark uses the course passing score above.</div></div><button type="button" class="btn btn-sm" data-auris-module-onclick="b0044"><i class="ti ti-plus"></i>Add question</button></div><label class="elc-quiz-toggle"><input id="elc-quiz-enabled" type="checkbox" checked data-auris-module-onchange="b0045"> Require final quiz</label><div id="elc-path-questions"></div>';
    var assign=Array.from(document.querySelectorAll('#elc-form .card')).find(function(x){return x.textContent.includes('Assign required employees');});
    (assign||group)?.insertAdjacentElement('beforebegin',card);
    renderBuilder();
  }
  function readBuilder(){
    pathDraft=Array.from(document.querySelectorAll('.elc-lesson-row')).map(function(row,i){return {id:row.dataset.id||uid('lesson'),sequence:i+1,title:row.querySelector('[data-field="title"]')?.value||'',video_url:row.querySelector('[data-field="url"]')?.value||'',duration_minutes:Number(row.querySelector('[data-field="duration"]')?.value||0)||null};});
    quizDraft.enabled=!!document.getElementById('elc-quiz-enabled')?.checked;
    quizDraft.questions=Array.from(document.querySelectorAll('.elc-question-row')).map(function(row,i){return {id:row.dataset.id||uid('question'),sequence:i+1,prompt:row.querySelector('[data-field="prompt"]')?.value||'',options:[0,1,2].map(function(n){return row.querySelector('[data-option="'+n+'"]')?.value||'';}),correct_index:Number(row.querySelector('[data-field="correct"]')?.value||0)};});
  }
  function renderBuilder(){
    ensureBuilder();
    var lessons=document.getElementById('elc-path-lessons');if(lessons)lessons.innerHTML=pathDraft.map(function(x,i){return '<div class="elc-lesson-row" data-id="'+escH(x.id)+'"><span class="elc-seq">'+(i+1)+'</span><input data-field="title" placeholder="Video title" value="'+escH(x.title||'')+'"><input data-field="url" placeholder="Video URL (MP4, WebM...)" value="'+escH(x.video_url||'')+'"><input class="elc-duration-input" data-field="duration" type="number" min="1" placeholder="Mins" value="'+escH(x.duration_minutes||'')+'"><button type="button" class="icon-btn" data-auris-module-onclick="b0046" data-auris-module-args="'+encodeURIComponent(JSON.stringify([i]))+'" aria-label="Remove video"><i class="ti ti-trash"></i></button></div>';}).join('')||'<div class="muted">No structured videos yet. Add a video or keep the legacy single-video link.</div>';
    var enabled=document.getElementById('elc-quiz-enabled');if(enabled)enabled.checked=quizDraft.enabled!==false;
    var questions=document.getElementById('elc-path-questions');if(questions){questions.style.display=quizDraft.enabled===false?'none':'';questions.innerHTML=quizDraft.questions.map(function(q,i){return '<div class="elc-question-row" data-id="'+escH(q.id)+'"><span class="elc-seq">'+(i+1)+'</span><input data-field="prompt" placeholder="Question" value="'+escH(q.prompt||'')+'"><input data-option="0" placeholder="Answer A" value="'+escH(q.options?.[0]||'')+'"><input data-option="1" placeholder="Answer B" value="'+escH(q.options?.[1]||'')+'"><input data-option="2" placeholder="Answer C" value="'+escH(q.options?.[2]||'')+'"><select data-field="correct"><option value="0" '+(q.correct_index===0?'selected':'')+'>Correct: A</option><option value="1" '+(q.correct_index===1?'selected':'')+'>Correct: B</option><option value="2" '+(q.correct_index===2?'selected':'')+'>Correct: C</option></select><button type="button" class="icon-btn" data-auris-module-onclick="b0047" data-auris-module-args="'+encodeURIComponent(JSON.stringify([i]))+'" aria-label="Remove question"><i class="ti ti-trash"></i></button></div>';}).join('')||'<div class="muted">Add at least one question to activate the final quiz.</div>';}
  }
  window.elcPathAddLesson=function(){readBuilder();pathDraft.push({id:uid('lesson'),title:'Video '+(pathDraft.length+1),video_url:'',duration_minutes:null});renderBuilder();};
  window.elcPathRemoveLesson=function(i){readBuilder();pathDraft.splice(i,1);renderBuilder();};
  window.elcPathAddQuestion=function(){readBuilder();quizDraft.questions.push({id:uid('question'),prompt:'',options:['','',''],correct_index:0});renderBuilder();};
  window.elcPathRemoveQuestion=function(i){readBuilder();quizDraft.questions.splice(i,1);renderBuilder();};
  window.elcPathToggleQuiz=function(on){readBuilder();quizDraft.enabled=!!on;renderBuilder();};

  window.elcNew=function(){legacyNew.apply(this,arguments);pathDraft=[];quizDraft={enabled:true,questions:[]};ensureBuilder();renderBuilder();};
  window.elcEdit=async function(id){await legacyEdit.apply(this,arguments);var rows=await api('/elearning_courses?id=eq.'+encodeURIComponent(id)+'&select=*').catch(function(){return[];});var c=rows?.[0]||(window.elcCourseById?elcCourseById(id):null);pathDraft=coursePath(c);quizDraft=courseQuiz(c);ensureBuilder();renderBuilder();};
  window.elcFullBody=function(g,title){readBuilder();var body=legacyFullBody(g,title);body.learning_path=cleanPath(pathDraft);body.quiz_config=cleanQuiz({enabled:quizDraft.enabled,passing_score:body.passing_score,questions:quizDraft.questions},body);if(body.learning_path.length)body.course_url=body.learning_path[0].video_url;return body;};

  async function loadCourse(id){var c=elcCourseById(id);if(c)return c;var rows=await api('/elearning_courses?id=eq.'+encodeURIComponent(id)+'&select=*').catch(function(){return[];});return rows?.[0]||null;}
  window.elcLaunch=async function(id){var c=await loadCourse(id);if(!c||!coursePath(c).length){toast('No course video available',false);return;}auditLogEvent('open','training','E-learning course previewed',{course_id:c.id||null,course_title:c.title||null},{related_table:'elearning_courses',related_id:c.id||null,company_id:c.company_id||ccid()});eleOpenVideoPlayer({course:c,preview:true});};
  window.eleLaunchEnrolment=async function(id){try{var rows=await api('/elearning_enrolments?id=eq.'+id+'&select=*');var enrol=rows?.[0];if(!enrol){toast('Enrolment not found',false);return;}var course=await loadCourse(enrol.course_id);if(!course||!coursePath(course).length){toast('No course video available',false);return;}eleOpenVideoPlayer({course:course,enrolment:enrol,preview:false});}catch(e){toast(actionErrorMessage('Launch e-learning','Training register',e.message),false);}};

  function progressMap(enrol){var p=enrol?.learning_progress;return p&&typeof p==='object'&&!Array.isArray(p)?p:{};}
  window.eleOpenVideoPlayer=function(opts){
    opts=opts||{};var course=opts.course||{},enrol=opts.enrolment||null,preview=!!opts.preview,lessons=coursePath(course),quiz=courseQuiz(course),progress=progressMap(enrol),index=0;
    var old=document.getElementById('ele-video-modal');if(old)old.remove();
    var modal=document.createElement('div');modal.id='ele-video-modal';modal.className='ele-video-modal';
    modal.innerHTML='<div class="ele-video-shell ele-course-shell" role="dialog" aria-modal="true"><div class="ele-video-head"><div><div class="ele-course-modal-title">'+escH(course.title||'E-learning course')+'</div><div class="ele-course-modal-subtitle">'+escH(preview?'Course preview':'Structured learning path')+'</div></div><button class="icon-btn ele-course-close" data-auris-module-onclick="b0048"><i class="ti ti-x"></i></button></div><div class="ele-video-body"><div class="ele-course-layout"><div id="ele-course-stage" class="ele-course-stage"></div><aside id="ele-course-outline" class="ele-course-outline"></aside></div></div></div>';
    document.body.appendChild(modal);modal.addEventListener('click',function(e){if(e.target===modal)eleCloseVideoPlayer();});
    function allVideosDone(){return lessons.every(function(l){return preview||progress[l.id]?.completed;});}
    function outline(){var box=document.getElementById('ele-course-outline');if(!box)return;box.innerHTML=lessons.map(function(l,i){var done=preview||!!progress[l.id]?.completed;var locked=!preview&&i>0&&!progress[lessons[i-1].id]?.completed;return '<button class="ele-outline-item '+(i===index?'active ':'')+(done?'done ':'')+(locked?'locked':'')+'" '+(locked?'disabled':'')+' data-auris-module-onclick="b0049" data-auris-module-args="'+encodeURIComponent(JSON.stringify([i]))+'"><span class="ele-outline-dot">'+(done?'✓':(i+1))+'</span><span>'+escH(l.title)+'</span></button>';}).join('')+(quiz.enabled?'<button class="ele-outline-item '+(index===lessons.length?'active ':'')+(enrol?.quiz_passed?'done ':'')+(!allVideosDone()?'locked':'')+'" '+(!allVideosDone()?'disabled':'')+' data-auris-module-onclick="b0049" data-auris-module-args="'+encodeURIComponent(JSON.stringify([lessons.length]))+'"><span class="ele-outline-dot">'+(enrol?.quiz_passed?'✓':'?')+'</span><span>Final quiz</span></button>':'');}
    async function saveLesson(l,video){if(preview||progress[l.id]?.completed)return;progress[l.id]={completed:true,completed_at:new Date().toISOString(),watched_seconds:Math.round(video.duration||video.currentTime||0)};var all=allVideosDone();var body={learning_progress:progress,watch_progress_pct:Math.round(Object.values(progress).filter(function(x){return x.completed;}).length/lessons.length*100),watched_seconds:Object.values(progress).reduce(function(n,x){return n+Number(x.watched_seconds||0);},0),status:'in_progress',updated_at:new Date().toISOString()};if(all)body.watch_completed_at=new Date().toISOString();try{await elePatchWithTrackingFallback(enrol.id,body);}catch(e){toast('Run elearning_course_path_upgrade.sql to record lesson progress.',false);}outline();}
    function renderVideo(){
      var l=lessons[index],stage=document.getElementById('ele-course-stage'),embed=youtubeEmbedUrl(l.video_url);
      var media=embed?'<iframe id="ele-watch-external" class="ele-watch-player ele-watch-embed" src="'+escH(embed)+'" title="'+escH(l.title)+'" loading="eager" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>':'<video id="ele-watch-video" class="ele-watch-player" controls controlsList="nodownload noplaybackrate noremoteplayback" disablePictureInPicture playsinline preload="metadata" data-auris-module-oncontextmenu="b0050" src="'+escH(l.video_url)+'"></video>';
      var confirm=embed&&!preview&&!progress[l.id]?.completed?'<button id="ele-external-complete" type="button" class="btn btn-sm"><i class="ti ti-check"></i>Confirm video completed</button>':'';
      stage.innerHTML='<h3 class="ele-course-stage-title">'+escH((index+1)+'. '+l.title)+'</h3>'+media+'<div class="ele-watch-note">'+(embed?'Authoritative externally hosted video. '+(preview?'Preview mode does not record completion.':'Confirm completion after watching to unlock the next item.'):'Viewing only. Download controls and the context menu are disabled. Complete this video to unlock the next item.')+'</div>'+confirm+'<div class="ele-course-nav"><button class="btn" '+(index===0?'disabled':'')+' data-auris-module-onclick="b0049" data-auris-module-args="'+encodeURIComponent(JSON.stringify([(index-1)]))+'"><i class="ti ti-chevron-left"></i>Previous</button><button id="ele-path-next" class="btn btn-primary" '+(!preview&&!progress[l.id]?.completed?'disabled':'')+' data-auris-module-onclick="b0049" data-auris-module-args="'+encodeURIComponent(JSON.stringify([(index+1)]))+'">Next<i class="ti ti-chevron-right"></i></button></div>';
      var video=document.getElementById('ele-watch-video');if(video)video.addEventListener('ended',async function(){await saveLesson(l,video);var b=document.getElementById('ele-path-next');if(b)b.disabled=false;toast(index===lessons.length-1&&quiz.enabled?'Videos complete. Final quiz unlocked.':'Video complete. Next item unlocked.');});
      var external=document.getElementById('ele-external-complete');if(external)external.addEventListener('click',async function(){await saveLesson(l,{duration:Number(l.duration_minutes||0)*60,currentTime:Number(l.duration_minutes||0)*60});var b=document.getElementById('ele-path-next');if(b)b.disabled=false;external.remove();toast(index===lessons.length-1&&quiz.enabled?'Videos complete. Final quiz unlocked.':'Video complete. Next item unlocked.');});
    }
    function renderQuiz(){var stage=document.getElementById('ele-course-stage');if(!allVideosDone()){index=Math.max(0,lessons.length-1);renderVideo();return;}stage.innerHTML='<div class="ele-quiz-panel"><h3 class="ele-quiz-title">Final quiz</h3><p class="muted">Pass mark: '+quiz.passing_score+'%</p><form id="ele-final-quiz">'+quiz.questions.map(function(q,i){return '<div class="ele-quiz-question"><strong>'+(i+1)+'. '+escH(q.prompt)+'</strong>'+q.options.map(function(o,j){return '<label class="ele-quiz-option"><input type="radio" name="q'+i+'" value="'+j+'"> <span>'+escH(o)+'</span></label>';}).join('')+'</div>';}).join('')+'<button type="submit" class="btn btn-primary ele-quiz-submit"><i class="ti ti-check"></i>Submit quiz</button></form></div>';document.getElementById('ele-final-quiz').addEventListener('submit',submitQuiz);}
    async function submitQuiz(e){e.preventDefault();if(preview){toast('Quiz answers are not recorded in preview mode.');return;}var answers=quiz.questions.map(function(q,i){var v=e.target.querySelector('input[name="q'+i+'"]:checked');return v?Number(v.value):-1;});if(answers.includes(-1)){toast('Please answer every question.',false);return;}var correct=answers.filter(function(a,i){return a===quiz.questions[i].correct_index;}).length;var score=Math.round(correct/quiz.questions.length*100),passed=score>=quiz.passing_score,now=new Date().toISOString(),today=now.slice(0,10);var attemptNo=Number(enrol.attempts||0)+1;try{await api('/elearning_quiz_attempts',{m:'POST',p:'return=minimal',b:{company_id:ccid(),course_id:String(course.id),enrolment_id:String(enrol.id),learner_profile_id:prof?.id||null,attempt_no:attemptNo,answers:answers,score:score,passing_score:quiz.passing_score,passed:passed}});var body={score:score,attempts:attemptNo,quiz_passed:passed,quiz_completed_at:now,status:passed?'completed':'in_progress',updated_at:now};if(passed){body.completion_date=today;body.valid_from=today;body.expiry_date=eleAddMonthsISO(today,course.validity_months||12);}await elePatchWithTrackingFallback(enrol.id,body);toast(passed?'Quiz passed with '+score+'%. Training completed.':'Score '+score+'%. Pass mark is '+quiz.passing_score+'%. Please review and retry.',passed);if(passed)eleCloseVideoPlayer();}catch(err){toast(actionErrorMessage('Save quiz result','E-learning',err.message),false);}}
    window._eleCourseGo=function(i){if(i<0||i>lessons.length)return;if(i===lessons.length){index=i;renderQuiz();outline();return;}if(!preview&&i>0&&!progress[lessons[i-1].id]?.completed){toast('Complete the previous video first.',false);return;}index=i;renderVideo();outline();};
    renderVideo();outline();
  };
  document.addEventListener('DOMContentLoaded',ensureBuilder);
})();

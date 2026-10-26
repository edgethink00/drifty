// Prepared-worker candidate. This API cannot target another process.
// Preserve unrelated flags and restore the exact saved policy after each job.
struct OwnPowerApi {
 PROCESS_POWER_THROTTLING_STATE read(){
  PROCESS_POWER_THROTTLING_STATE s{};s.Version=PROCESS_POWER_THROTTLING_CURRENT_VERSION;
  check_bool(GetProcessInformation(GetCurrentProcess(),ProcessPowerThrottling,&s,sizeof(s)));return s;
 }
 void write(PROCESS_POWER_THROTTLING_STATE const&state){
  auto copy=state;check_bool(SetProcessInformation(GetCurrentProcess(),ProcessPowerThrottling,&copy,sizeof(copy)));
 }
};
bool samePowerPolicy(PROCESS_POWER_THROTTLING_STATE const&a,PROCESS_POWER_THROTTLING_STATE const&b){
 return a.Version==b.Version&&a.ControlMask==b.ControlMask&&a.StateMask==b.StateMask;
}
template<class Api>class JobPowerScope {
 Api&api;bool&failureLatch;
 bool entered=false,mayHaveChanged=false,restoreAttempted=false;
public:
 PROCESS_POWER_THROTTLING_STATE saved{},applied{},restored{};
 bool restoreVerified=false;
 JobPowerScope(Api&a,bool&failure):api(a),failureLatch(failure){}
 JobPowerScope(JobPowerScope const&)=delete;
 JobPowerScope&operator=(JobPowerScope const&)=delete;
 void enter(){
  require(!entered);entered=true;saved=api.read();
  constexpr ULONG known=PROCESS_POWER_THROTTLING_EXECUTION_SPEED|PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION;
  require(saved.Version==PROCESS_POWER_THROTTLING_CURRENT_VERSION);
  require((saved.ControlMask&~known)==0&&(saved.StateMask&~known)==0);
  applied=saved;applied.ControlMask|=PROCESS_POWER_THROTTLING_EXECUTION_SPEED;
  applied.StateMask&=~PROCESS_POWER_THROTTLING_EXECUTION_SPEED;
  if(samePowerPolicy(saved,applied)){restored=saved;restoreVerified=true;return;}
  mayHaveChanged=true; // cleanup also covers an API failure after a partial mutation
  try{api.write(applied);require(samePowerPolicy(api.read(),applied));}
  catch(...){
   // A fresh read can prove that a failed write left the saved state intact.
   // Preserve the original failure; never continue the job on a failed apply.
   try{auto current=api.read();if(samePowerPolicy(current,saved)){restored=current;mayHaveChanged=false;restoreVerified=true;}}catch(...){}
   throw;
  }
 }
 void restore(){
  require(entered&&!restoreAttempted);restoreAttempted=true;
  if(mayHaveChanged){api.write(saved);restored=api.read();require(samePowerPolicy(restored,saved));mayHaveChanged=false;restoreVerified=true;}
  require(restoreVerified);
 }
 ~JobPowerScope(){
  if(mayHaveChanged&&!restoreAttempted){try{restore();}catch(...){failureLatch=true;}}
  if(mayHaveChanged)failureLatch=true;
 }
};

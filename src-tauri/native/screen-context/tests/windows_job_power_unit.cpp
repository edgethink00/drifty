#define wmain unused_power_benchmark_main
#include "../windows.cpp"
#undef wmain
#include <stdexcept>
using PowerState=PROCESS_POWER_THROTTLING_STATE;
PowerState state(ULONG control=0,ULONG flags=0){return {PROCESS_POWER_THROTTLING_CURRENT_VERSION,control,flags};}
struct FakePowerApi {
 PowerState current;unsigned reads=0,writes=0,failRead=0,failWrite=0,mismatchRead=0;bool partialWrite=false;
 PowerState read(){
  ++reads;if(reads==failRead)throw std::runtime_error("read failure");
  auto s=current;if(reads==mismatchRead)s.StateMask^=PROCESS_POWER_THROTTLING_EXECUTION_SPEED;return s;
 }
 void write(PowerState const&s){
  ++writes;if(writes==failWrite){if(partialWrite)current=s;throw std::runtime_error("write failure");}current=s;
 }
};
struct Case {
 const char*name;PowerState original=state();unsigned failRead=0,failWrite=0,mismatchRead=0;
 bool partialWrite=false,bodyThrows=false,doubleEnter=false,doubleRestore=false;
 bool expectedThrow=false,expectedLatch=false;unsigned expectedWrites=2;bool endsApplied=false;
};
unsigned qa_pure_power_passed=0;
unsigned pureTests(){
 const ULONG execution=PROCESS_POWER_THROTTLING_EXECUTION_SPEED,timer=PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION;
 std::vector<Case> cases;
 cases.push_back({"default restores exactly"});
 {Case c{"timer-on flags preserved"};c.original=state(timer,timer);cases.push_back(c);}
 {Case c{"timer-off control preserved"};c.original=state(timer,0);cases.push_back(c);}
 {Case c{"preexisting eco policy restored"};c.original=state(execution,execution);cases.push_back(c);}
 {Case c{"preexisting high policy is a no-op"};c.original=state(execution,0);c.expectedWrites=0;cases.push_back(c);}
 {Case c{"high with timer is a no-op"};c.original=state(execution|timer,timer);c.expectedWrites=0;cases.push_back(c);}
 {Case c{"saved read failure never writes"};c.failRead=1;c.expectedThrow=true;c.expectedWrites=0;cases.push_back(c);}
 {Case c{"unknown version refuses"};c.original.Version=0;c.expectedThrow=true;c.expectedWrites=0;cases.push_back(c);}
 {Case c{"unknown control refuses"};c.original.ControlMask=0x80000000u;c.expectedThrow=true;c.expectedWrites=0;cases.push_back(c);}
 {Case c{"unknown state refuses"};c.original.StateMask=0x80000000u;c.expectedThrow=true;c.expectedWrites=0;cases.push_back(c);}
 {Case c{"failed unchanged apply preserves error"};c.failWrite=1;c.expectedThrow=true;c.expectedWrites=1;cases.push_back(c);}
 {Case c{"failed partial apply restores"};c.failWrite=1;c.partialWrite=true;c.expectedThrow=true;cases.push_back(c);}
 {Case c{"apply readback failure restores"};c.failRead=2;c.expectedThrow=true;cases.push_back(c);}
 {Case c{"apply mismatch restores"};c.mismatchRead=2;c.expectedThrow=true;cases.push_back(c);}
 {Case c{"body failure restores"};c.bodyThrows=true;c.expectedThrow=true;cases.push_back(c);}
 {Case c{"restore write failure latches without retry"};c.failWrite=2;c.expectedThrow=true;c.expectedLatch=true;c.endsApplied=true;cases.push_back(c);}
 {Case c{"partial restore failure remains unaccepted"};c.failWrite=2;c.partialWrite=true;c.expectedThrow=true;c.expectedLatch=true;cases.push_back(c);}
 {Case c{"missing restore readback remains unaccepted"};c.failRead=3;c.expectedThrow=true;c.expectedLatch=true;cases.push_back(c);}
 {Case c{"double enter cannot replace saved state"};c.doubleEnter=true;c.expectedThrow=true;cases.push_back(c);}
 {Case c{"double restore cannot write twice"};c.doubleRestore=true;c.expectedThrow=true;cases.push_back(c);}
 {Case c{"managed state bits are retained"};c.original=state(0,execution);cases.push_back(c);}
 {Case c{"no-op body failure does not write"};c.original=state(execution,0);c.bodyThrows=true;c.expectedThrow=true;c.expectedWrites=0;cases.push_back(c);}
 require(cases.size()==22);unsigned passed=0;
 for(auto const&c:cases){
  std::cerr<<"power_scope_case_begin:"<<passed<<std::endl;
  FakePowerApi api{c.original};api.failRead=c.failRead;api.failWrite=c.failWrite;api.mismatchRead=c.mismatchRead;api.partialWrite=c.partialWrite;
  bool latch=false,thrown=false;
  try{
   JobPowerScope<FakePowerApi>scope(api,latch);scope.enter();
   if(c.doubleEnter)scope.enter();if(c.bodyThrows)throw std::runtime_error("job failure");
   scope.restore();if(c.doubleRestore)scope.restore();require(scope.restoreVerified);
  }catch(...){thrown=true;}
  auto expected=c.original;if(c.endsApplied){expected.ControlMask|=execution;expected.StateMask&=~execution;}
  if(thrown!=c.expectedThrow||latch!=c.expectedLatch||api.writes!=c.expectedWrites||!samePowerPolicy(api.current,expected)){
   std::cerr<<"power_scope_case_failed:"<<passed<<":"<<c.name<<std::endl;throw std::runtime_error("case failed");
  }
  std::cerr<<"power_scope_case_pass:"<<passed<<std::endl;
  ++passed;qa_pure_power_passed=passed;
 }
 return passed;
}
struct UnitWatchdog {
 std::atomic<bool>done{false};std::thread guard;
 UnitWatchdog():guard([this]{auto start=GetTickCount64();while(!done){if(GetTickCount64()-start>=5000)TerminateProcess(GetCurrentProcess(),4);Sleep(5);}}){}
 ~UnitWatchdog(){done=true;guard.join();}
};
int wmain(int argc,wchar_t**argv){
 UnitWatchdog bounded;
 if(argc==1){try{auto passed=pureTests();std::cout<<"{\"passed\":"<<passed<<",\"uiOrCaptureAccess\":false,\"nativePowerMutation\":false}";return 0;}catch(...){std::cout<<"{\"passed\":"<<qa_pure_power_passed<<",\"failed\":true}";return 2;}}
 if(argc!=2||std::wstring(argv[1])!=L"--kernel-roundtrip")return 2;
 bool latch=false,passed=false;int32_t hr=0;PowerState saved{},applied{},restored{};
 try{
  OwnPowerApi api;auto original=api.read();
  {JobPowerScope<OwnPowerApi>scope(api,latch);scope.enter();saved=scope.saved;applied=scope.applied;require(samePowerPolicy(original,saved));require(samePowerPolicy(api.read(),applied));scope.restore();restored=api.read();require(scope.restoreVerified&&samePowerPolicy(original,restored));}
  require(!latch);passed=true;
 }catch(hresult_error const&e){hr=static_cast<int32_t>(e.code());}catch(...){hr=static_cast<int32_t>(E_UNEXPECTED);}
 std::cout<<"{\"passed\":"<<(passed?"true":"false")<<",\"hresult\":"<<hr<<",\"restorationFailure\":"<<(latch?"true":"false")
 <<",\"savedControlMask\":"<<saved.ControlMask<<",\"savedStateMask\":"<<saved.StateMask<<",\"appliedControlMask\":"<<applied.ControlMask
 <<",\"appliedStateMask\":"<<applied.StateMask<<",\"restoredControlMask\":"<<restored.ControlMask<<",\"restoredStateMask\":"<<restored.StateMask
 <<",\"currentProcessOnly\":true,\"uiOrCaptureAccess\":false}";
 return passed?0:2;
}

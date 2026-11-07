#include <node_api.h>
#define NOMINMAX
#include <windows.h>
#include <dwmapi.h>
#include <cstring>
#include <algorithm>
#include <cmath>
#include <cstdint>

struct AccentPolicy {
 int state;
 int flags;
 DWORD gradientColor;
 int animationId;
};

struct WindowCompositionAttributeData {
 int attribute;
 void* data;
 SIZE_T size;
};

using SetWindowCompositionAttributeFn = BOOL(WINAPI*)(HWND, WindowCompositionAttributeData*);

static bool readOwnedWindow(napi_env env, napi_value value, HWND& hwnd) {
 void* data=nullptr; size_t size=0;
 if(napi_get_buffer_info(env,value,&data,&size)!=napi_ok || size!=sizeof(HWND)) return false;
 std::memcpy(&hwnd,data,sizeof(hwnd));
 DWORD pid=0; GetWindowThreadProcessId(hwnd,&pid);
 return pid==GetCurrentProcessId();
}

static napi_value apply(napi_env env, napi_callback_info info) {
 size_t count=2; napi_value args[2]; napi_get_cb_info(env,info,&count,args,nullptr,nullptr);
 bool square=false; HWND hwnd=nullptr;
 if(count!=2 || !readOwnedWindow(env,args[0],hwnd) || napi_get_value_bool(env,args[1],&square)!=napi_ok) {napi_throw_type_error(env,nullptr,"Expected owned HWND Buffer and square boolean");return nullptr;}
 // DWM is the single owner of the window contour. Windows 11 clips the whole
 // composed window, including the Accent Acrylic backdrop, with an
 // anti-aliased rounded corner. The renderer must stay square (CSS radius 0
 // under native glass); a second CSS arc leaves a crescent of the dark accent
 // tint between the two curves. Emulated maximize/fullscreen pass square=true
 // because DWM cannot see Electron's transparent-window maximize.
 // A custom SetWindowRgn is never used: it is aliased and can make DWM drop
 // the system backdrop while the frameless window is maximized.
 const DWM_WINDOW_CORNER_PREFERENCE cornerPreference = square ? DWMWCP_DONOTROUND : DWMWCP_ROUND;
 const HRESULT cornerResult = DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, &cornerPreference, sizeof(cornerPreference));
 const bool regionCleared = SetWindowRgn(hwnd, nullptr, TRUE) != 0;
 // Before Windows 11 the corner attribute is unsupported; the window stays square.
 const bool ok = regionCleared && (square || SUCCEEDED(cornerResult) || cornerResult == E_INVALIDARG);
 napi_value result; napi_get_boolean(env,ok,&result); return result;
}

static napi_value setAccentAcrylic(napi_env env, napi_callback_info info) {
 size_t count=2; napi_value args[2]; napi_get_cb_info(env,info,&count,args,nullptr,nullptr);
 bool enabled=false; HWND hwnd=nullptr;
 if(count!=2 || !readOwnedWindow(env,args[0],hwnd) || napi_get_value_bool(env,args[1],&enabled)!=napi_ok) {napi_throw_type_error(env,nullptr,"Expected owned HWND Buffer and enabled boolean");return nullptr;}
 auto user32=GetModuleHandleW(L"user32.dll");
 auto setter=user32?reinterpret_cast<SetWindowCompositionAttributeFn>(GetProcAddress(user32,"SetWindowCompositionAttribute")):nullptr;
 bool ok=false;
 if(setter) {
  // WCA_ACCENT_POLICY=19; state 4 is Accent Acrylic and state 0 disables it.
  // Gradient color uses AABBGGRR. The renderer supplies the remaining tint.
  AccentPolicy policy{enabled?4:0,0,enabled?0x99110E08u:0u,0};
  WindowCompositionAttributeData data{19,&policy,sizeof(policy)};
  ok=setter(hwnd,&data)!=FALSE;
 }
 napi_value result; napi_get_boolean(env,ok,&result); return result;
}

// Removing a system backdrop can leave DWM's backing opaque even though the
// Chromium surface contains alpha. Re-establish full-client alpha composition.
static napi_value restoreTransparency(napi_env env, napi_callback_info info) {
 size_t count=1; napi_value args[1]; HWND hwnd=nullptr;
 napi_get_cb_info(env,info,&count,args,nullptr,nullptr);
 if(count!=1 || !readOwnedWindow(env,args[0],hwnd)) {napi_throw_type_error(env,nullptr,"Owned HWND required");return nullptr;}
 const MARGINS margins{-1,-1,-1,-1};
 const HRESULT hr=DwmExtendFrameIntoClientArea(hwnd,&margins);
 napi_value result; napi_get_boolean(env,SUCCEEDED(hr),&result); return result;
}

static bool readSurface(napi_env env, napi_value value, HWND& hwnd) {
 if(!readOwnedWindow(env,value,hwnd) || !IsWindow(hwnd)) return false;
 wchar_t name[64]{}; GetClassNameW(hwnd,name,64);
 return wcscmp(name,L"ASTRELISVideoSurface")==0;
}
static napi_value createVideoSurface(napi_env env,napi_callback_info info) {
 size_t count=1;napi_value args[1];napi_get_cb_info(env,info,&count,args,nullptr,nullptr);HWND parent=nullptr;
 if(count!=1 || !readOwnedWindow(env,args[0],parent)){napi_throw_type_error(env,nullptr,"Owned parent required");return nullptr;}
 WNDCLASSW wc{};wc.lpfnWndProc=DefWindowProcW;wc.hInstance=GetModuleHandleW(nullptr);wc.lpszClassName=L"ASTRELISVideoSurface";wc.hbrBackground=(HBRUSH)GetStockObject(BLACK_BRUSH);
 RegisterClassW(&wc);
 HWND child=CreateWindowExW(WS_EX_NOACTIVATE,wc.lpszClassName,L"",WS_CHILD|WS_DISABLED|WS_CLIPCHILDREN|WS_CLIPSIBLINGS,0,0,1,1,parent,nullptr,wc.hInstance,nullptr);
 if(!child){napi_throw_error(env,nullptr,"Video surface creation failed");return nullptr;}
 napi_value result;napi_create_buffer_copy(env,sizeof(child),&child,nullptr,&result);return result;
}
static napi_value moveVideoSurface(napi_env env,napi_callback_info info) {
 size_t count=6;napi_value args[6];napi_get_cb_info(env,info,&count,args,nullptr,nullptr);HWND child=nullptr;double v[4]{};bool visible=false;
 bool valid=count==6&&readSurface(env,args[0],child)&&napi_get_value_bool(env,args[5],&visible)==napi_ok;
 for(int i=0;i<4&&valid;i++)valid=napi_get_value_double(env,args[i+1],&v[i])==napi_ok&&std::isfinite(v[i])&&v[i]>=0&&v[i]<32768;
 if(!valid){napi_throw_type_error(env,nullptr,"Invalid video surface bounds");return nullptr;}
 HWND parent=GetParent(child);const double scale=GetDpiForWindow(parent)/96.0;RECT client{};GetClientRect(parent,&client);
 int x=std::clamp((int)std::lround(v[0]*scale),0,(int)client.right),y=std::clamp((int)std::lround(v[1]*scale),0,(int)client.bottom);
 int w=std::clamp((int)std::lround(v[2]*scale),0,(int)client.right-x),h=std::clamp((int)std::lround(v[3]*scale),0,(int)client.bottom-y);
 SetWindowPos(child,HWND_TOP,x,y,std::max(1,w),std::max(1,h),SWP_NOACTIVATE);
 ShowWindow(child,visible&&w>1&&h>1?SW_SHOWNOACTIVATE:SW_HIDE);
 napi_value result;napi_get_boolean(env,true,&result);return result;
}
static napi_value inspectVideoSurface(napi_env env,napi_callback_info info) {
 size_t count=1;napi_value args[1];napi_get_cb_info(env,info,&count,args,nullptr,nullptr);HWND parent=nullptr;
 if(count!=1||!readOwnedWindow(env,args[0],parent)){napi_throw_type_error(env,nullptr,"Owned parent required");return nullptr;}
 HWND child=FindWindowExW(parent,nullptr,L"ASTRELISVideoSurface",nullptr);RECT r{};GetWindowRect(child,&r);
 POINT origin{r.left,r.top};ScreenToClient(parent,&origin);napi_value out,v;napi_create_object(env,&out);
 auto num=[&](const char* name,int value){napi_create_int32(env,value,&v);napi_set_named_property(env,out,name,v);};
 num("x",origin.x);num("y",origin.y);num("width",r.right-r.left);num("height",r.bottom-r.top);num("dpi",GetDpiForWindow(parent));num("visible",IsWindowVisible(child));num("child",child&&GetParent(child)==parent);num("rendererChild",GetWindow(child,GW_CHILD)!=nullptr);
 return out;
}
NAPI_MODULE_INIT(){
 napi_value applyFn,acrylicFn;
 napi_create_function(env,"apply",NAPI_AUTO_LENGTH,apply,nullptr,&applyFn);
 napi_create_function(env,"setAccentAcrylic",NAPI_AUTO_LENGTH,setAccentAcrylic,nullptr,&acrylicFn);
 napi_set_named_property(env,exports,"apply",applyFn);
 napi_set_named_property(env,exports,"setAccentAcrylic",acrylicFn);
 napi_value transparentFn;
 napi_create_function(env,"restoreTransparency",NAPI_AUTO_LENGTH,restoreTransparency,nullptr,&transparentFn);
 napi_set_named_property(env,exports,"restoreTransparency",transparentFn);
 napi_value createFn,moveFn;
 napi_create_function(env,"createVideoSurface",NAPI_AUTO_LENGTH,createVideoSurface,nullptr,&createFn);
 napi_create_function(env,"moveVideoSurface",NAPI_AUTO_LENGTH,moveVideoSurface,nullptr,&moveFn);
 napi_set_named_property(env,exports,"createVideoSurface",createFn);
 napi_set_named_property(env,exports,"moveVideoSurface",moveFn);
 napi_value inspectFn;napi_create_function(env,"inspectVideoSurface",NAPI_AUTO_LENGTH,inspectVideoSurface,nullptr,&inspectFn);napi_set_named_property(env,exports,"inspectVideoSurface",inspectFn);
 return exports;
}

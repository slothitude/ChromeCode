export const existsSync = () => false;
export const readFileSync = () => "";
export const writeFileSync = () => {};
export const mkdirSync = () => {};
export const join = (...args) => args.join('/');
export const resolve = (...args) => args.join('/');
export const dirname = (p) => p.split('/').slice(0, -1).join('/');
export const platform = () => "browser";
export const randomUUID = () => crypto.randomUUID();
export const EventEmitter = class { 
  on() {} 
  once() {} 
  emit() {} 
  removeListener() {} 
};
export default {};

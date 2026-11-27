// Files feature: state and actions (Files tab, attachments in the input box, file tools for the model), by role;
// the feature's other modules import them from here. Depends on core state; core state never imports this (it
// registers itself through extension points).
export * from './lists';
export * from './pages';
export * from './navigation';
export * from './manage';
export * from './imports';
export * from './workdir';

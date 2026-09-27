import type { TaskKind } from '../../domain/types.js';
export const REAL_API_STRENGTH:Record<TaskKind,number>={chat:.76,debug:.88,refactor:.86,architecture:.9,generate:.92,test:.9,docs:.86,explain:.9,performance:.88,security:.82};
export const LOCAL_STRENGTH:Record<TaskKind,number>={chat:.72,debug:.9,refactor:.82,architecture:.78,generate:.88,test:.9,docs:.76,explain:.84,performance:.86,security:.92};
export const DEMO_STRENGTH:Record<TaskKind,number>={chat:.35,debug:.3,refactor:.3,architecture:.3,generate:.3,test:.3,docs:.3,explain:.3,performance:.3,security:.3};

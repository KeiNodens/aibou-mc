// toolgate 単体検証 (D28)
import { computePresentation, MOD_GATES } from '../bridge/src/toolgate.ts';

let fails = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name} ${extra}`);
  if (!cond) fails++;
};
const ALL = ['get_state', 'send_chat', 'projecte_status', 'refinedstorage_status',
  'contraption_ride', 'quest_plan', 'quest_frontier', 'emi_search', 'waypoint_save',
  'build_schematic', 'jei_search', 'warp', 'work_journal'];
const none = { enabled: [], disabled: [] };

// mod 未接続: ゲート対象は全部オフ、既定オフもオフ、素のツールはオン
let m = computePresentation(ALL, null, none);
check('disconnected: core on', m.get('get_state') === true);
check('disconnected: projecte off', m.get('projecte_status') === false);
check('disconnected: quest off', m.get('quest_plan') === false);
check('disconnected: default-off stays off', m.get('emi_search') === false && m.get('waypoint_save') === false);

// 彼のパック相当 (create/ftbquests/jei/projecte あり、RS/waystones なし)
m = computePresentation(ALL, new Set(['create', 'ftbquests', 'jei', 'projecte']), none);
check('pack: contraption on', m.get('contraption_ride') === true);
check('pack: quest on', m.get('quest_plan') === true);
check('pack: rs off', m.get('refinedstorage_status') === false);
check('pack: warp off', m.get('warp') === false);
check('pack: quest_frontier stays default-off', m.get('quest_frontier') === false);

// 設定で強制オン/オフ + グループ
m = computePresentation(ALL, null, { enabled: ['waypoint_save', 'refinedstorage_status'], disabled: ['group:build', 'get_state'] });
check('config: force on default-off', m.get('waypoint_save') === true);
check('config: force on gated', m.get('refinedstorage_status') === true);
check('config: group off', m.get('build_schematic') === false);
check('config: disabled wins over core', m.get('get_state') === false);

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);

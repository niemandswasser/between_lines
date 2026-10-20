import { ConnectionManagerRequestService } from '../../shared.js';
import { startBetweenLines } from './runtime.js';

jQuery(() => {
  try { startBetweenLines({ context: () => SillyTavern.getContext(), service: ConnectionManagerRequestService }); }
  catch (error) { console.error('[Между строк]', error); globalThis.toastr?.error('Не удалось запустить кодекс: ' + error.message, 'Между строк'); }
});

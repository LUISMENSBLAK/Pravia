import { Router } from 'express';
import { AgendaController } from '../controllers/agenda.controller';

const router = Router();

router.get('/catalogos', AgendaController.catalogs);
router.get('/tareas', AgendaController.listTasks);
router.post('/tareas', AgendaController.createTask);
router.patch('/tareas/:id', AgendaController.updateTask);
router.get('/', AgendaController.list);
router.post('/', AgendaController.create);
router.patch('/:id', AgendaController.update);
router.post('/:id/cancelar', AgendaController.cancel);

export default router;

import express from 'express';
import {
  getNotarias,
  getNotariaById,
  createNotaria,
  updateNotaria,
  setNotariaPredeterminada,
  archiveNotaria
} from '../controllers/notarias.controller';

const router = express.Router();

router.get('/', getNotarias);
router.get('/:id', getNotariaById);
router.post('/', createNotaria);
router.put('/:id', updateNotaria);
router.patch('/:id/predeterminada', setNotariaPredeterminada);
router.patch('/:id/archivar', archiveNotaria);

export default router;

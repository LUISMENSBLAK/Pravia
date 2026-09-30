-- Roles operativos mínimos requeridos para el equipo real de la Notaría.
-- PostgreSQL conserva los valores existentes y agrega únicamente los nuevos.
ALTER TYPE "pravia_os"."Role" ADD VALUE IF NOT EXISTS 'CONTADORA';

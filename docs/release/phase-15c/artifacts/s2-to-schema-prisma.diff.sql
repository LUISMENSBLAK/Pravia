-- RenameForeignKey
ALTER TABLE "expediente_representaciones" RENAME CONSTRAINT "expediente_representaciones_expediente_compareciente_repr_fkey1" TO "fk_exp_rep_compareciente_representante";

-- RenameForeignKey
ALTER TABLE "expediente_representaciones" RENAME CONSTRAINT "expediente_representaciones_expediente_compareciente_repre_fkey" TO "fk_exp_rep_compareciente_representado";

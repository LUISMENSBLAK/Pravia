import type { Request, Response } from 'express';
import prisma from '../config/prisma';
import { CommercialPropertyError, CommercialPropertyService, type CommercialPropertyKind } from '../services/commercialProperty.service';
const service = new CommercialPropertyService(prisma);
export const commercialPropertyHandler = (kind: CommercialPropertyKind, action: 'read'|'options'|'select') => async (req:Request,res:Response)=>{
  try {
    if(!req.user) return res.status(401).json({code:'AUTH_REQUIRED',error:'Inicia sesión para continuar.'});
    const data=action==='read'?await service.read(req.user,kind,req.params.id):action==='options'?await service.options(req.user,kind,req.params.id,String(req.query.search||'')):await service.select(req.user,kind,req.params.id,req.body||{});
    return res.json({data});
  } catch(error){
    if(error instanceof CommercialPropertyError) return res.status(error.status).json({code:error.code,error:error.message});
    console.error('Commercial property operation failed',{error_name:error instanceof Error?error.name:'Error'});
    return res.status(500).json({code:'COMMERCIAL_PROPERTY_FAILED',error:'No fue posible completar el cambio de inmueble.'});
  }
};

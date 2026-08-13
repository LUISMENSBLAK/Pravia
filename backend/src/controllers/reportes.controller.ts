import type {Request,Response} from 'express';
import prisma from '../config/prisma';
import {ReportingService} from '../services/reporting.service';
const service=new ReportingService(prisma);
const run=(handler:(user:NonNullable<Request['user']>,query:any)=>Promise<unknown>)=>async(req:Request,res:Response)=>{try{if(!req.user)return res.status(401).json({code:'AUTH_REQUIRED',error:'Inicia sesión para continuar.'});return res.json({success:true,data:await handler(req.user,req.query)});}catch(error:any){return res.status(400).json({success:false,code:'REPORT_QUERY_INVALID',error:error.message||'No fue posible generar el reporte.'});}};
export class ReportesController{
 static catalogs=run((user)=>service.catalogs(user));
 static summary=run((user,query)=>service.summary(user,query));
 static finance=run((user,query)=>service.finance(user,query));
 static collections=run((user,query)=>service.collections(user,query));
 static lawyers=run((user,query)=>service.lawyers(user,query));
 static signatures=run((user,query)=>service.signatures(user,query));
 static eightyTwenty=run((user,query)=>service.eightyTwenty(user,query));
 static potentialClients=run((user,query)=>service.potentialClients(user,query));
 static async createTarget(req:Request,res:Response){try{if(!req.user)return res.status(401).json({code:'AUTH_REQUIRED',error:'Inicia sesión para continuar.'});return res.status(201).json({success:true,data:await service.createTarget(req.user,req.body||{})});}catch(error:any){return res.status(400).json({success:false,code:'REPORT_TARGET_INVALID',error:error.message||'No fue posible configurar la meta.'});}}
 static async updateTarget(req:Request,res:Response){try{if(!req.user)return res.status(401).json({code:'AUTH_REQUIRED',error:'Inicia sesión para continuar.'});return res.json({success:true,data:await service.updateTarget(req.user,req.params.id,req.body||{})});}catch(error:any){return res.status(400).json({success:false,code:'REPORT_TARGET_INVALID',error:error.message||'No fue posible modificar la meta.'});}}
 static async closeTarget(req:Request,res:Response){try{if(!req.user)return res.status(401).json({code:'AUTH_REQUIRED',error:'Inicia sesión para continuar.'});return res.json({success:true,data:await service.closeTarget(req.user,req.params.id)});}catch(error:any){return res.status(400).json({success:false,code:'REPORT_TARGET_INVALID',error:error.message||'No fue posible cerrar la meta.'});}}
}

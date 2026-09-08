import type { Pool, PoolClient } from 'pg';
import { ValidationError } from '../core/errors.js';

type Queryable=Pool|PoolClient;

export interface ReproductionRules {
  id_propiedad:string|null;
  dias_posparto_para_celo:number;
  dias_posparto_para_prenez:number;
  dias_posaborto_para_celo:number;
  dias_posaborto_para_prenez:number;
  edad_minima_celo_meses:number;
  edad_minima_padre_meses:number;
  permitir_segundo_celo:boolean;
  permitir_celo_falso_en_prenez:boolean;
  usar_ultimo_celo_valido:boolean;
  dias_maximos_ordeno_posparto:number;
}

const defaults:ReproductionRules={
  id_propiedad:null,dias_posparto_para_celo:30,dias_posparto_para_prenez:45,
  dias_posaborto_para_celo:21,dias_posaborto_para_prenez:30,
  edad_minima_celo_meses:12,edad_minima_padre_meses:12,
  permitir_segundo_celo:true,permitir_celo_falso_en_prenez:true,
  usar_ultimo_celo_valido:true,dias_maximos_ordeno_posparto:305,
};

export async function reproductionRulesForAnimal(client:Queryable,animalId:string):Promise<ReproductionRules>{
  const row=(await client.query(
    `SELECT property.id_propiedad,
       COALESCE(cp.dias_posparto_para_celo,30)::int dias_posparto_para_celo,
       COALESCE(cp.dias_posparto_para_prenez,45)::int dias_posparto_para_prenez,
       COALESCE(cp.dias_posaborto_para_celo,21)::int dias_posaborto_para_celo,
       COALESCE(cp.dias_posaborto_para_prenez,30)::int dias_posaborto_para_prenez,
       COALESCE(cp.edad_minima_celo_meses,12)::int edad_minima_celo_meses,
       COALESCE(cp.edad_minima_padre_meses,12)::int edad_minima_padre_meses,
       COALESCE(cp.permitir_segundo_celo,TRUE) permitir_segundo_celo,
       COALESCE(cp.permitir_celo_falso_en_prenez,TRUE) permitir_celo_falso_en_prenez,
       COALESCE(cp.usar_ultimo_celo_valido,TRUE) usar_ultimo_celo_valido,
       COALESCE(cp.dias_maximos_ordeno_posparto,305)::int dias_maximos_ordeno_posparto
     FROM animal a
     LEFT JOIN ubicacion au ON au.id_ubicacion=a.id_ubicacion_actual
     LEFT JOIN grupo ag ON ag.id_grupo=a.id_grupo_actual
     LEFT JOIN LATERAL(
       SELECT COALESCE(au.id_propiedad,ag.id_propiedad,(
         SELECT p.id_propiedad FROM propiedad_ganadera p
         WHERE p.deleted_at IS NULL ORDER BY p.es_principal DESC,p.activa DESC LIMIT 1
       )) id_propiedad
     ) property ON TRUE
     LEFT JOIN configuracion_propiedad cp ON cp.id_propiedad=property.id_propiedad
     WHERE a.id_animal=$1 AND a.deleted_at IS NULL`,[animalId],
  )).rows[0] as ReproductionRules|undefined;
  return row??defaults;
}

async function latestEventDate(client:Queryable,table:string,animalColumn:string,animalId:string,eventDate:string){
  const dateExpression=table==='parto'?'fecha_parto':table==='aborto'?'COALESCE(fecha,created_at::date)':'fecha';
  return (await client.query(
    `SELECT fecha::text FROM (SELECT ${dateExpression} AS fecha
       FROM ${table} WHERE ${animalColumn}=$1 AND deleted_at IS NULL
         AND ${dateExpression}<=$2::date
       ORDER BY ${dateExpression} DESC LIMIT 1) event`,[animalId,eventDate],
  )).rows[0]?.fecha as string|undefined;
}

async function assertDaysSince(client:Queryable,label:string,eventDate:string,lastDate:string|undefined,minimum:number){
  if(!lastDate||minimum<=0)return;
  const elapsed=Number((await client.query('SELECT ($1::date-$2::date)::int days',[eventDate,lastDate])).rows[0]?.days??0);
  if(elapsed<minimum)throw new ValidationError(`${label}: deben transcurrir ${minimum} días; han pasado ${elapsed}.`);
}

export async function assertFemaleReproductionRules(
  client:Queryable,animalId:string,eventDate:string,kind:'CELO'|'PRENEZ',falseHeat=false,excludeHeatId?:string,excludePregnancyId?:string,
){
  const rules=await reproductionRulesForAnimal(client,animalId);
  const [lastBirth,lastAbortion,activePregnancy,heatCount]=await Promise.all([
    latestEventDate(client,'parto','id_madre',animalId,eventDate),
    latestEventDate(client,'aborto','id_vaca',animalId,eventDate),
    client.query(`SELECT 1 FROM prenez WHERE id_vaca=$1 AND estado='CONFIRMADA' AND deleted_at IS NULL
      AND ($2::uuid IS NULL OR id_prenez<>$2::uuid) LIMIT 1`,[animalId,excludePregnancyId??null]),
    client.query(`SELECT COUNT(*)::int total FROM celo WHERE id_vaca=$1 AND deleted_at IS NULL
      AND fecha_inicio<=$2::date AND ($3::uuid IS NULL OR id_celo<>$3::uuid)
      AND fecha_inicio>GREATEST(COALESCE((SELECT MAX(fecha_parto) FROM parto WHERE id_madre=$1 AND deleted_at IS NULL),'-infinity'::date),COALESCE((SELECT MAX(COALESCE(fecha,created_at::date)) FROM aborto WHERE id_vaca=$1 AND deleted_at IS NULL),'-infinity'::date))`,[animalId,eventDate,excludeHeatId??null]),
  ]);
  if(kind==='CELO'){
    if(activePregnancy.rowCount&&!falseHeat)throw new ValidationError('La vaca tiene una preñez confirmada. Solo se puede registrar un celo si se marca como falso.');
    if(falseHeat&&!rules.permitir_celo_falso_en_prenez)throw new ValidationError('La configuración de la propiedad no permite registrar celos falsos.');
    if(!rules.permitir_segundo_celo&&Number(heatCount.rows[0]?.total??0)>0)throw new ValidationError('La configuración de la propiedad no permite registrar un segundo celo en este ciclo.');
    await assertDaysSince(client,'Aún no se puede registrar el celo después del parto',eventDate,lastBirth,rules.dias_posparto_para_celo);
    await assertDaysSince(client,'Aún no se puede registrar el celo después del aborto',eventDate,lastAbortion,rules.dias_posaborto_para_celo);
  }else{
    if(activePregnancy.rowCount)throw new ValidationError('Esta vaca ya tiene una preñez confirmada pendiente de finalizar.');
    await assertDaysSince(client,'Aún no se puede confirmar la preñez después del parto',eventDate,lastBirth,rules.dias_posparto_para_prenez);
    await assertDaysSince(client,'Aún no se puede confirmar la preñez después del aborto',eventDate,lastAbortion,rules.dias_posaborto_para_prenez);
  }
  return rules;
}

export async function assertMinimumAge(client:Queryable,birthDate:string|null,eventDate:string,months:number,role:string){
  if(!birthDate||months<=0)return;
  const allowed=(await client.query(`SELECT $1::date+($3::int*INTERVAL '1 month')<=$2::date permitido`,[birthDate,eventDate,months])).rows[0]?.permitido;
  if(!allowed)throw new ValidationError(`${role} debe tener al menos ${months} meses de edad en la fecha seleccionada.`);
}

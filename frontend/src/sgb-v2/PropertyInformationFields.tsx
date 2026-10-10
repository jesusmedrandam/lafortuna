import {Field,Input,Select} from '../components/ui';
import type {PropertyInformation} from './api';
export function propertyInformationFrom(form:HTMLFormElement):PropertyInformation {
  const data=new FormData(form);
  return {name:String(data.get('name')).trim(),ownerName:String(data.get('ownerName')).trim(),
    areaValue:Number(data.get('areaValue')),areaUnitCode:data.get('areaUnitCode') as PropertyInformation['areaUnitCode'],address:String(data.get('address')).trim()};
}
export function PropertyInformationFields({value,ownerName}:{value?:PropertyInformation;ownerName?:string}){
  return <div className="form-grid">
    <Field label="Nombre de la propiedad" required><Input name="name" defaultValue={value?.name} minLength={2} maxLength={160} required/></Field>
    <Field label="Propietario" required><Input name="ownerName" defaultValue={value?.ownerName??ownerName} minLength={2} maxLength={160} required/></Field>
    <Field label="Extensión" required><Input name="areaValue" type="number" min="0.0001" max="999999999" step="0.0001" defaultValue={value?.areaValue??''} required/></Field>
    <Field label="Unidad"><Select name="areaUnitCode" defaultValue={value?.areaUnitCode??'HECTARE'}><option value="HECTARE">Hectáreas</option><option value="SQUARE_METER">Metros cuadrados</option></Select></Field>
    <Field label="Ubicación" required><Input name="address" defaultValue={value?.address??''} minLength={2} maxLength={500} placeholder="Dirección, sector, cantón y provincia" required/></Field>
  </div>;
}

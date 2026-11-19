"use client"
import {Download,Printer} from "lucide-react"
import {Button} from "@/components/ui/button"
export function Exports({title,headers,rows}:{title:string;headers:string[];rows:(string|number)[][]}) {
  function download(){
    const cell=(entry:string|number)=>{
      const value=String(entry).replace(/[<>&"']/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&apos;"}[c] ?? c))
      return '<Cell><Data ss:Type="'+(typeof entry==="number"?"Number":"String")+'">'+value+'</Data></Cell>'
    }
    const contents=[headers,...rows].map(row=>"<Row>"+row.map(cell).join("")+"</Row>").join("")
    const blob=new Blob(['<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Relatório"><Table>'+contents+"</Table></Worksheet></Workbook>"],{type:"application/xml;charset=utf-8"})
    const url=URL.createObjectURL(blob)
    const link=document.createElement("a")
    link.href=url;link.download=title+".xml";link.click()
    setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  return <div className="inline-actions"><Button onClick={download} variant="outline"><Download size={16}/> Excel</Button><Button onClick={()=>window.print()} variant="outline"><Printer size={16}/> Imprimir / PDF</Button></div>
}

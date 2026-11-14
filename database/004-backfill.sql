update pedidos
set status_kanban = case
  when cancelado then 'cancelado'
  when finalizado then 'concluido'
  else 'novo'
end
where status_kanban = 'novo' and (cancelado or finalizado);

update pedidos set valor_bruto = total where valor_bruto is null;

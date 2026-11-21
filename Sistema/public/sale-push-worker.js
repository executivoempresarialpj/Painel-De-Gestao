self.addEventListener("push", event => {
  if (!event.data) return
  const {id,title,body} = event.data.json()
  event.waitUntil(self.registration.showNotification(title,{
    body,
    icon:"/icone.png",
    tag:"sale-"+id
  }))
})

self.addEventListener("notificationclick", event => {
  event.notification.close()
  event.waitUntil(clients.openWindow("/"))
})

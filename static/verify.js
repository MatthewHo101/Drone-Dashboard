document.querySelector("form").onsubmit = async event => {
  event.preventDefault();
  try {
    const response = await fetch("/verify", {method:"POST", headers:{"Content-Type":"application/json","X-Fieldbench":"1"},
      body:JSON.stringify({code:event.target.elements.code.value})});
    if (!response.ok) throw Error((await response.json()).error);
    location.reload();
  } catch (error) { document.querySelector("[role=alert]").textContent = error.message; }
};

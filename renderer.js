/* global $ loadJsonFile shell Materialize storage */
// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// All of the Node.js APIs are available in this process.

nodeRequire('dotenv').config({path:'_env'})
const loadJsonFile = nodeRequire('load-json-file')
const {shell} = nodeRequire('electron')
const storage = nodeRequire('electron-json-storage')

let cfg, eid, oecdCode, parentId, dueDate, redmineApiKey

$(document).ready(function () {
  // INITIALIZATIOM
  disableSubtickets()
  $('select').material_select()
  $('.modal').modal({
  })
  $('.datepicker').pickadate({
    // TODO: would be nice to be able to use a user-friendly date for display
    //       and a Redmine-friendly date for submission; but this doesn't
    //       work yet in this modified version of the datepicker.
    // formatSubmit: 'yyyy-mm-dd',
    // format: 'd mmmm yyyy',
    min: new Date(),
    format: 'yyyy-mm-dd',
    selectMonths: true, // Creates a dropdown to control month
    selectYears: 10 // Creates a dropdown of 10 years to control year
  })
  loadJsonFile('config.json').then(json => { cfg = json })
  checkForRedmineApiKey()

  // EVENT HANDLERS
  $('div.modal').on('click', 'a.external', (evt) => {
    shell.openExternal($(evt.target).attr('href'))
    evt.preventDefault()
  })
  $('form#dossier-form').on('reset', (evt) => {
    Materialize.updateTextFields()
  })
  // KAPPAV3 LOOKUP
  $('#eid').on('blur', (evt) => {
    eid = evt.target.value
    if (eid === '') {
      $('#pubtitle').val('')
      return
    }
    console.log(`EID: ${eid}.`)
    $.ajax({
      url: `${process.env.KV3_URL}${eid}?apikey=${process.env.KV3_API_KEY}`,
      dataType: 'xml',
      success: function (data) {
        const kv3id = $(data).find('rid')[0].textContent.split(':').pop()
        // TODO: this is clearly not precise enough, but good enough for a POC
        oecdCode = $(data).find('identifier')[0].textContent
        const title = $(data).find('title')[0].textContent
        $('#pubtitle').val(title)

        const desc = $('#description').val()
        if (desc !== '') {
          // TODO: should be updating not replacing
          $('#description').val(
            '* Book submission link: \n' +
            `* Kappa v2 link: http://pac-apps.oecd.org/kappa/Search/Results.asp?QuickSearch=ID:${oecdCode}\n` +
            `* Kappa v3 link: http://kappa.oecd.org/v3/Expression/Details/${kv3id}\n`
          )
        } else {
          $('#description').val(
            '* Book submission link: \n' +
            `* Kappa v2 link: http://pac-apps.oecd.org/kappa/Search/Results.asp?QuickSearch=ID:${oecdCode}\n` +
            `* Kappa v3 link: http://kappa.oecd.org/v3/Expression/Details/${kv3id}\n`
          )
        }
      }
    })
  })

  // SUBMIT FORM
  $('#submit').on('click', (evt) => {
    // TODO: make this work ... not much validation going on right now 😞
    // $('#dossier-form').validate({
    //   rules: {
    //     pubtype: 'required'
    //   },
    //   submitHandler: (form) => {
    //     console.log('not doing much ...')
    //   }
    // })

    // prepare main ticket
    eid = $('#eid').val()
    dueDate = $('#due-date').val()
    const subject = `${oecdCode} - ${cfg['publication-types'][$('#pubtype').val()].name} - ${$('#pubtitle').val()}`
    const mainTicket = {
      'issue': {
        'project_id': cfg.project['project-id'],
        'due_date': dueDate,
        'tracker_id': cfg.project['tracker-id'], // typically "Task"
        'category_id': cfg['publication-types'][$('#pubtype').val()]['redmine-category-id'],
        'subject': subject,
        'description': $('#description').val()
      }
    }

    // send main ticket
    $.ajax(`${process.env.REDMINE_API_URL}/issues.json`, {
      data: JSON.stringify(mainTicket),
      contentType: 'application/json',
      method: 'POST',
      headers: {
        'X-Redmine-API-Key': redmineApiKey
      }
    })

    // success for main ticket
    .done((data, status, xhr) => {
      parentId = data.issue.id
      // loop over all select subtickets and create them
      $('div#subtickets input[type=checkbox]:checked').each(function (index) {
        const ticketType = this.id
        const ticketConfig = cfg.subtasks[ticketType]
        const subTicket = {
          'issue': {
            'tracker_id': cfg.project['tracker-id'], // typically "Task"
            'due_date': dueDate,
            'category_id': ticketConfig['redmine-category-id'],
            'project_id': cfg.project['project-id'],
            'subject': `___ ${oecdCode} - ${ticketConfig.name}`,
            'watcher_user_ids': ticketConfig.watchers,
            'parent_issue_id': parentId
          }
        }
        console.log('SUBTICKET about to be submitted:')
        console.log(subTicket)

        $.ajax(`${process.env.REDMINE_API_URL}/issues.json`, {
          data: JSON.stringify(subTicket),
          contentType: 'application/json',
          method: 'POST',
          headers: {
            'X-Redmine-API-Key': redmineApiKey
          }
        })
        // success for one specific subticket
        .done((data, status, error) => {
          console.log(`*** created subticket: ${status}: ${JSON.stringify(data)}`)
        })
        // fail for a subticket
        .fail((xhr, status, error) => {
          $('#modalresult .modal-content').append(`<p>There was an error: '${error}'.<br/><code>xhr.status=${xhr.status}</code><br/>Please ask someone ...</p>`)
          $('.modal h4').html(`<i class="material-icons small">bug_report</i> Failure`)
          $('#modalresult').modal('open', {
            dismissable: true,
            complete: function () {
              $('div.modal-content p').remove()
              $('div.modal-content h4').empty()
            }
          })
        })
      })
      const u = `${process.env.REDMINE_API_URL}/issues/${parentId}`
      $('#modalresult .modal-content').append(`<p>Tickets have been created successfully. The main ticket is here: <a class='external' href='${u}'>${u}</a></p>`)
      $('.modal h4').html(`<i class="material-icons small">check</i> Success`)
      $('#modalresult').modal('open', {
        dismissable: true,
        complete: function () {
          $('div.modal-content p').remove()
          $('div.modal-content h4').empty()
        }
      })
      $('#dossier-form')[0].reset()
    })
    // fail for main ticket
    .fail((xhr, status, error) => {
      $('#modalresult .modal-content').append(`<p>There was an error: '${error}'.<br/><code>xhr.status=${xhr.status}</code><br/>Please ask someone ...</p>`)
      $('.modal h4').html(`<i class="material-icons small">bug_report</i> Failure`)
      $('#modalresult').modal('open', {
        dismissable: true,
        complete: function () {
          $('div.modal-content p').remove()
          $('div.modal-content h4').empty()
        }
      })
    })
    .always(() => {
    })
    evt.preventDefault()
  })

  // what to do when publication type changes
  $('#pubtype').on('change', (evt) => {
    switch (evt.target.value) {
      case 'pubstat':
        unselectSubtickets()
        $('#t-cover').prop('checked', true)
        $('#t-mls').prop('checked', true)
        $('#t-threepages').prop('checked', true)
        enableSubtickets()
        break

      case 'crc':
        unselectSubtickets()
        $('#t-cover').prop('checked', true)
        $('#t-mls').prop('checked', true)
        $('#t-graphics').prop('checked', true)
        enableSubtickets()
        break

      case 'vrd':
        unselectSubtickets()
        $('#t-body').prop('checked', true)
        $('#t-mls').prop('checked', true)
        enableSubtickets()
        break

      case 'typeset':
        unselectSubtickets()
        $('#t-cover').prop('checked', true)
        $('#t-body').prop('checked', true)
        $('#t-threepages').prop('checked', true)
        enableSubtickets()
        break

      default:
        unselectSubtickets()
        disableSubtickets()
    }
  })

  $('#key-submit').on('click', (evt) => {
    console.log(`The key: ${$('#redmine-api-key').val()}`)
    redmineApiKey = $('#redmine-api-key').val()
    storage.set('redmine-api-key', redmineApiKey, (err) => {
      if (err) throw err

      $('#modalkey').modal('close')
      storage.get('redmine-api-key', (err, data) => {
        if (err) throw err
        console.log(data)
        redmineApiKey = data
      })
    })
  })
})

function unselectSubtickets () {
  $('#subtickets :checkbox').prop('checked', false)
}
function disableSubtickets () {
  $('#subtickets :checkbox').prop('disabled', true)
}
function enableSubtickets () {
  $('#subtickets :checkbox').prop('disabled', false)
}
function checkForRedmineApiKey () {
  storage.has('redmine-api-key', (err, hasKey) => {
    if (err) throw err
    if (hasKey) {
      storage.get('redmine-api-key', (err, data) => {
        if (err) throw err
        console.log(`STORED KEY DATA: ${JSON.stringify(data)}`);
        redmineApiKey = data
      })
    } else {
      $('#modalkey').modal('open', {
        dismissable: false
      })
      //console.log(`Location of user data: ${app.getPath('userData')}.`)
    }
  })
}
